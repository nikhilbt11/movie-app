import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

import {
  S3Client,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// --------------------------------------------------
// ENVIRONMENT VARIABLES
// --------------------------------------------------

const ENV_KEYS = [
  'MONGODB_URI',
  'ADMIN_PASSWORD',
  'JWT_SECRET',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_ACCESS_KEY_ID',
  'CLOUDFLARE_SECRET_ACCESS_KEY',
  'CLOUDFLARE_BUCKET_NAME',
  'CLOUDFLARE_R2_PUBLIC_URL',
];

function getEnv() {
  const values = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]])
  );

  const missing = ENV_KEYS.filter((key) => !values[key]);

  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  return values;
}

let s3;

function getS3Client() {
  const {
    CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_ACCESS_KEY_ID,
    CLOUDFLARE_SECRET_ACCESS_KEY,
  } = getEnv();

  if (!s3) {
    s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: CLOUDFLARE_ACCESS_KEY_ID,
        secretAccessKey: CLOUDFLARE_SECRET_ACCESS_KEY,
      },
    });
  }

  return s3;
}

// --------------------------------------------------
// MONGODB
// --------------------------------------------------

let cached =
  globalThis._mongo ||
  (globalThis._mongo = {
    conn: null,
    promise: null,
  });

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  const { MONGODB_URI } = getEnv();

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
    });
  }

  cached.conn = await cached.promise;

  return cached.conn;
}

// --------------------------------------------------
// MOVIE MODEL
// --------------------------------------------------

const Movie =
  mongoose.models.Movie ||
  mongoose.model(
    'Movie',
    new mongoose.Schema(
      {
        title: {
          type: String,
          required: true,
          trim: true,
        },

        description: {
          type: String,
          default: '',
          trim: true,
        },

        posterUrl: {
          type: String,
          required: true,
        },

        videoUrl: {
          type: String,
          required: true,
        },

        downloadUrl: {
          type: String,
          required: true,
        },

        r2PosterKey: {
          type: String,
        },

        r2VideoKey: {
          type: String,
        },

        size: {
          type: Number,
        },
      },
      {
        timestamps: true,
      }
    )
  );

// --------------------------------------------------
// AUTH
// --------------------------------------------------

const signToken = () => {
  const { JWT_SECRET } = getEnv();

  return jwt.sign(
    {
      admin: true,
    },
    JWT_SECRET,
    {
      expiresIn: '7d',
    }
  );
};

const verifyToken = (token) => {
  try {
    const { JWT_SECRET } = getEnv();
    const decoded = jwt.verify(token, JWT_SECRET);

    return decoded?.admin === true;
  } catch {
    return false;
  }
};

const requireAdmin = (req, res, next) => {
  const authorization = req.headers.authorization || '';

  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : '';

  if (!verifyToken(token)) {
    return res.status(401).json({
      error: 'Please log in again.',
    });
  }

  next();
};

// --------------------------------------------------
// EXPRESS
// --------------------------------------------------

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Vercel invokes /api/index.js for /api/* requests. Local Vite development
// also sends /api/* requests through its proxy. Normalize both forms so the
// Express routes themselves stay clean and portable.
app.use((req, res, next) => {
  if (req.url === '/api') {
    req.url = '/';
  } else if (req.url.startsWith('/api/')) {
    req.url = req.url.slice(4);
  }

  next();
});

// --------------------------------------------------
// DATABASE MIDDLEWARE
// --------------------------------------------------

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('Database connection failed:', error);

    res.status(500).json({
      error: 'Database connection failed.',
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// --------------------------------------------------
// LOGIN
// --------------------------------------------------

app.post('/login', (req, res) => {
  const { password } = req.body || {};

  const { ADMIN_PASSWORD } = getEnv();

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      error: 'Wrong password.',
    });
  }

  res.json({
    token: signToken(),
  });
});

// --------------------------------------------------
// PUBLIC MOVIE ROUTES
// --------------------------------------------------

// Get all movies
app.get('/movies', async (req, res) => {
  try {
    const movies = await Movie.find()
      .sort({
        createdAt: -1,
      })
      .select('title posterUrl');

    res.json(movies);
  } catch (error) {
    console.error('Failed to get movies:', error);

    res.status(500).json({
      error: 'Failed to load movies.',
    });
  }
});

// Get one movie
app.get('/movies/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({
        error: 'Movie not found.',
      });
    }

    const movie = await Movie.findById(req.params.id);

    if (!movie) {
      return res.status(404).json({
        error: 'Movie not found.',
      });
    }

    res.json(movie);
  } catch (error) {
    console.error('Failed to get movie:', error);

    res.status(500).json({
      error: 'Failed to load movie.',
    });
  }
});

// --------------------------------------------------
// ADMIN: PRESIGNED R2 UPLOAD URL
// --------------------------------------------------

app.post(
  '/presigned-url',
  requireAdmin,
  async (req, res) => {
    try {
      const { CLOUDFLARE_BUCKET_NAME, CLOUDFLARE_R2_PUBLIC_URL } = getEnv();
      const r2 = getS3Client();
      const {
        filename,
        type,
        contentType,
      } = req.body || {};

      if (!filename || !type || !contentType) {
        return res.status(400).json({
          error:
            'Filename, type and contentType are required.',
        });
      }

      // Only these two upload types are allowed.
      if (!['poster', 'video'].includes(type)) {
        return res.status(400).json({
          error: 'Invalid upload type.',
        });
      }

      // Validate poster MIME type.
      if (
        type === 'poster' &&
        !contentType.startsWith('image/')
      ) {
        return res.status(400).json({
          error: 'Poster must be an image.',
        });
      }

      // Validate movie MIME type.
      if (
        type === 'video' &&
        contentType !== 'video/x-matroska'
      ) {
        return res.status(400).json({
          error: 'Movie must be an MKV video.',
        });
      }

      // Store posters and movies in separate folders.
      const folder =
        type === 'poster'
          ? 'posters'
          : 'movies';

      // Prevent strange characters from entering the R2 key.
      const safeFilename = filename.replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
      );

      const key = `${folder}/${Date.now()}-${safeFilename}`;

      // IMPORTANT:
      // This ContentType MUST match the Content-Type
      // used by the frontend when performing the PUT.
      const uploadCommand = new PutObjectCommand({
        Bucket: CLOUDFLARE_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(
        r2,
        uploadCommand,
        {
          expiresIn: 3600,
        }
      );

      // Permanent public R2 URL.
      const publicBase =
        CLOUDFLARE_R2_PUBLIC_URL.replace(/\/$/, '');

      const publicUrl =
        `${publicBase}/${key
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`;

      res.json({
        url: uploadUrl,
        key,
        publicUrl,
      });
    } catch (error) {
      console.error(
        'Failed to generate upload URL:',
        error
      );

      res.status(500).json({
        error:
          'Failed to generate upload URL.',
      });
    }
  }
);

// --------------------------------------------------
// ADMIN: SAVE MOVIE METADATA
// --------------------------------------------------

app.post(
  '/movies',
  requireAdmin,
  async (req, res) => {
    try {
      const {
        title,
        description,
        posterUrl,
        videoUrl,
        downloadUrl,
        r2PosterKey,
        r2VideoKey,
        size,
      } = req.body || {};

      if (
        !title ||
        !posterUrl ||
        !videoUrl ||
        !downloadUrl
      ) {
        return res.status(400).json({
          error:
            'Title, poster and movie file are required.',
        });
      }

      const movie = await Movie.create({
        title,
        description: description || '',
        posterUrl,
        videoUrl,
        downloadUrl,
        r2PosterKey,
        r2VideoKey,
        size,
      });

      res.status(201).json(movie);
    } catch (error) {
      console.error(
        'Failed to save movie:',
        error
      );

      res.status(500).json({
        error: 'Failed to save movie.',
      });
    }
  }
);

// --------------------------------------------------
// ADMIN: DELETE MOVIE
// --------------------------------------------------

app.delete(
  '/movies/:id',
  requireAdmin,
  async (req, res) => {
    try {
      const { CLOUDFLARE_BUCKET_NAME } = getEnv();
      const r2 = getS3Client();

      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(404).json({
          error: 'Movie not found.',
        });
      }

      const movie =
        await Movie.findByIdAndDelete(
          req.params.id
        );

      if (!movie) {
        return res.status(404).json({
          error: 'Movie not found.',
        });
      }

      // Delete poster from R2.
      if (movie.r2PosterKey) {
        try {
          await r2.send(
            new DeleteObjectCommand({
              Bucket: CLOUDFLARE_BUCKET_NAME,
              Key: movie.r2PosterKey,
            })
          );
        } catch (error) {
          console.error(
            'R2 poster delete failed:',
            error
          );
        }
      }

      // Delete movie from R2.
      if (movie.r2VideoKey) {
        try {
          await r2.send(
            new DeleteObjectCommand({
              Bucket: CLOUDFLARE_BUCKET_NAME,
              Key: movie.r2VideoKey,
            })
          );
        } catch (error) {
          console.error(
            'R2 movie delete failed:',
            error
          );
        }
      }

      res.json({
        ok: true,
      });
    } catch (error) {
      console.error(
        'Failed to delete movie:',
        error
      );

      res.status(500).json({
        error: 'Failed to delete movie.',
      });
    }
  }
);

// Keep unexpected synchronous errors in a predictable JSON shape.
app.use((error, req, res, next) => {
  console.error('Unhandled API error:', error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: 'Internal server error.',
  });
});

// Vercel imports this module as a serverless function. Do not start a
// persistent listener or perform external connectivity checks at import time.

export default app;

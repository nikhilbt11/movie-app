import { useEffect, useState } from 'react';
import { api, getToken, setToken } from '../api.js';

function Login({ onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const { token } = await api('/login', {
        method: 'POST',
        body: { password },
      });

      setToken(token);
      onDone();
    } catch (err) {
      setError(err?.message || 'Login failed.');
    }
  };

  return (
    <form className="box login" onSubmit={submit}>
      <label htmlFor="pw">Admin password</label>

      <input
        id="pw"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoFocus
      />

      <p>
        <button type="submit">Log in</button>
      </p>

      {error && <div className="msg err">{error}</div>}
    </form>
  );
}

function UploadForm({ onAdded }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [poster, setPoster] = useState(null);
  const [video, setVideo] = useState(null);

  const [progress, setProgress] = useState(null);

  const [msg, setMsg] = useState({
    text: '',
    type: '',
  });

  const busy = progress !== null;

  // --------------------------------------------------
  // GET MIME TYPE
  // --------------------------------------------------

  const getContentType = (file, type) => {
    if (type === 'video') {
      return 'video/x-matroska';
    }

    if (file?.type) {
      return file.type;
    }

    const extension = file?.name
      ?.split('.')
      .pop()
      ?.toLowerCase();

    const imageTypes = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      avif: 'image/avif',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
    };

    return imageTypes[extension] || 'application/octet-stream';
  };

  // --------------------------------------------------
  // UPLOAD FILE TO R2
  // --------------------------------------------------

  const uploadToR2 = async (file, type, progressStart, progressEnd) => {
    if (!file) {
      throw new Error(
        type === 'poster'
          ? 'Please select a poster image.'
          : 'Please select a movie file.'
      );
    }

    const contentType = getContentType(file, type);

    console.log('Requesting presigned URL:', {
      filename: file.name,
      type,
      contentType,
    });

    // Ask backend for a presigned upload URL.
    const response = await api('/presigned-url', {
      method: 'POST',
      auth: true,
      body: {
        filename: file.name,
        type,
        contentType,
      },
    });

    const {
      url,
      key,
      publicUrl,
    } = response;

    if (!url) {
      throw new Error(
        'Backend did not return an upload URL.'
      );
    }

    if (!key) {
      throw new Error(
        'Backend did not return an R2 key.'
      );
    }

    if (!publicUrl) {
      throw new Error(
        'Backend did not return a public URL.'
      );
    }

    // --------------------------------------------------
    // ACTUAL FILE UPLOAD TO R2
    // --------------------------------------------------

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) {
          return;
        }

        const fileProgress =
          e.loaded / e.total;

        const overallProgress =
          progressStart +
          fileProgress *
            (progressEnd - progressStart);

        setProgress(
          Math.round(overallProgress)
        );
      };

      xhr.onload = () => {
        if (
          xhr.status >= 200 &&
          xhr.status < 300
        ) {
          console.log(
            `✓ ${type} uploaded successfully`
          );

          resolve({
            key,
            publicUrl,
            contentType,
          });
        } else {
          console.error(
            'R2 upload failed:',
            xhr.status,
            xhr.responseText
          );

          reject(
            new Error(
              `Upload to R2 failed (${xhr.status}).`
            )
          );
        }
      };

      xhr.onerror = () => {
        reject(
          new Error(
            'Network error while uploading to R2.'
          )
        );
      };

      xhr.onabort = () => {
        reject(
          new Error(
            'Upload was cancelled.'
          )
        );
      };

      xhr.open('PUT', url);

      // IMPORTANT:
      // This MUST be exactly the same Content-Type
      // used when generating the presigned URL.
      xhr.setRequestHeader(
        'Content-Type',
        contentType
      );

      xhr.send(file);
    });
  };

  // --------------------------------------------------
  // SUBMIT MOVIE
  // --------------------------------------------------

  const submit = async (e) => {
    e.preventDefault();

    setMsg({
      text: '',
      type: '',
    });

    // Validate title.
    if (!title.trim()) {
      setMsg({
        text: 'Please enter a movie title.',
        type: 'err',
      });

      return;
    }

    // Validate poster.
    if (!poster) {
      setMsg({
        text: 'Please select a poster image.',
        type: 'err',
      });

      return;
    }

    // Validate movie.
    if (!video) {
      setMsg({
        text: 'Please select a movie file.',
        type: 'err',
      });

      return;
    }

    // Validate MKV.
    if (
      !video.name
        .toLowerCase()
        .endsWith('.mkv')
    ) {
      setMsg({
        text: 'The movie must be a .mkv file.',
        type: 'err',
      });

      return;
    }

    setMsg({
      text: 'Starting upload…',
      type: '',
    });

    setProgress(0);

    try {
      // ------------------------------------------------
      // 1. UPLOAD POSTER
      // ------------------------------------------------

      setMsg({
        text: 'Uploading poster…',
        type: '',
      });

      const posterResult =
        await uploadToR2(
          poster,
          'poster',
          0,
          10
        );

      // ------------------------------------------------
      // 2. UPLOAD MOVIE
      // ------------------------------------------------

      setMsg({
        text: 'Uploading movie… keep this page open.',
        type: '',
      });

      const videoResult =
        await uploadToR2(
          video,
          'video',
          10,
          100
        );

      // ------------------------------------------------
      // 3. SAVE MOVIE METADATA TO MONGODB
      // ------------------------------------------------

      setMsg({
        text: 'Saving movie information…',
        type: '',
      });

      await api('/movies', {
        method: 'POST',
        auth: true,

        body: {
          title: title.trim(),

          description:
            description.trim(),

          // IMPORTANT:
          // These are permanent R2 public URLs.
          posterUrl:
            posterResult.publicUrl,

          videoUrl:
            videoResult.publicUrl,

          downloadUrl:
            videoResult.publicUrl,

          // R2 object keys.
          r2PosterKey:
            posterResult.key,

          r2VideoKey:
            videoResult.key,

          size: video.size,
        },
      });

      // ------------------------------------------------
      // 4. SUCCESS
      // ------------------------------------------------

      setProgress(100);

      setMsg({
        text: 'Movie uploaded successfully.',
        type: 'ok',
      });

      // Clear form.
      setTitle('');
      setDescription('');
      setPoster(null);
      setVideo(null);

      e.target.reset();

      // Refresh movie list.
      if (onAdded) {
        await onAdded();
      }

      // Give user time to see 100%.
      setTimeout(() => {
        setProgress(null);
      }, 500);
    } catch (err) {
      console.error(
        'Movie upload error:',
        err
      );

      setMsg({
        text:
          err?.message ||
          'Movie upload failed.',
        type: 'err',
      });

      setProgress(null);
    }
  };

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <form
      className="box"
      onSubmit={submit}
    >
      <h2>Add a movie</h2>

      <label htmlFor="title">
        Title
      </label>

      <input
        id="title"
        type="text"
        value={title}
        onChange={(e) =>
          setTitle(e.target.value)
        }
        required
      />

      <label htmlFor="desc">
        Description
      </label>

      <textarea
        id="desc"
        value={description}
        onChange={(e) =>
          setDescription(e.target.value)
        }
      />

      <label htmlFor="poster">
        Poster image
      </label>

      <input
        id="poster"
        type="file"
        accept="image/*"
        onChange={(e) =>
          setPoster(
            e.target.files?.[0] || null
          )
        }
        required
      />

      <label htmlFor="video">
        Movie file (.mkv)
      </label>

      <input
        id="video"
        type="file"
        accept=".mkv,video/x-matroska"
        onChange={(e) =>
          setVideo(
            e.target.files?.[0] || null
          )
        }
        required
      />

      {busy && (
        <>
          <progress
            value={progress}
            max="100"
          />

          <div>
            {progress}%
          </div>
        </>
      )}

      <p>
        <button
          type="submit"
          disabled={busy}
        >
          {busy
            ? 'Uploading…'
            : 'Upload movie'}
        </button>
      </p>

      {msg.text && (
        <div
          className={`msg ${msg.type}`}
        >
          {msg.text}
        </div>
      )}
    </form>
  );
}

// --------------------------------------------------
// ADMIN
// --------------------------------------------------

export default function Admin() {
  const [loggedIn, setLoggedIn] =
    useState(!!getToken());

  const [movies, setMovies] =
    useState([]);

  const load = async () => {
    try {
      const data =
        await api('/movies');

      setMovies(data);
    } catch (error) {
      console.error(
        'Failed to load movies:',
        error
      );

      setMovies([]);
    }
  };

  useEffect(() => {
    if (loggedIn) {
      load();
    }
  }, [loggedIn]);

  return (
    <>
      {!loggedIn ? (
        <Login
          onDone={() =>
            setLoggedIn(true)
          }
        />
      ) : (
        <UploadForm
          onAdded={load}
        />
      )}
    </>
  );
}
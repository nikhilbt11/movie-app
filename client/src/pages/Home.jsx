import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Home() {
  const [movies, setMovies] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api('/movies').then(setMovies).catch(e => setError(e.message)); }, []);

  if (error) return <p className="empty err">{error}</p>;
  if (!movies) return <p className="empty">Loading…</p>;
  if (!movies.length) return <p className="empty">No movies yet. Add one from the admin panel.</p>;

  return (
    <div className="grid">
      {movies.map(m => (
        <Link key={m._id} className="movie" to={`/movie/${m._id}`}>
          <img src={m.posterUrl} alt={m.title} />
          <h3>{m.title}</h3>
        </Link>
      ))}
    </div>
  );
}

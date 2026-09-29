import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';

export default function Movie() {
  const { id } = useParams();
  const [movie, setMovie] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api('/movies/' + id).then(setMovie).catch(e => setError(e.message)); }, [id]);

  if (error) return <p className="empty">{error} <Link to="/">Back to movies</Link></p>;
  if (!movie) return <p className="empty">Loading…</p>;

  return (
    <div className="watch">
      <video controls preload="metadata" poster={movie.posterUrl} src={movie.videoUrl} />
      <h2>{movie.title}</h2>
      <p>{movie.description}</p>
      <a className="btn" href={movie.downloadUrl}>Download movie</a>
      <div className="note">If the video won't play in your browser, use Download and open it in VLC.</div>
    </div>
  );
}

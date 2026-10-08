import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Home() {
  const [movies, setMovies] = useState(null);
  const [likedByMovieId, setLikedByMovieId] = useState({});
  const [pendingMovieIds, setPendingMovieIds] = useState(() => new Set());
  const [likeErrors, setLikeErrors] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    Promise.all([api('/movies'), api('/movies/interactions')])
      .then(([movieList, interactions]) => {
        if (!active) return;

        setMovies(movieList);
        setLikedByMovieId(
          Object.fromEntries(
            interactions.map(({ movieId, liked }) => [movieId, liked])
          )
        );
      })
      .catch((e) => {
        if (active) setError(e.message);
      });

    return () => {
      active = false;
    };
  }, []);

  const toggleLike = async (event, movieId) => {
    event.stopPropagation();
    setPendingMovieIds((current) => new Set(current).add(movieId));
    setLikeErrors((current) => ({ ...current, [movieId]: '' }));

    try {
      const interaction = await api(`/movies/${movieId}/interaction/like`, {
        method: 'PATCH',
      });
      setLikedByMovieId((current) => ({
        ...current,
        [movieId]: interaction.liked,
      }));
    } catch (e) {
      setLikeErrors((current) => ({ ...current, [movieId]: e.message }));
    } finally {
      setPendingMovieIds((current) => {
        const next = new Set(current);
        next.delete(movieId);
        return next;
      });
    }
  };

  if (error) return <p className="empty err">{error}</p>;
  if (!movies) return <p className="empty">Loading…</p>;
  if (!movies.length) return <p className="empty">No movies yet. Add one from the admin panel.</p>;

  return (
    <div className="grid">
      {movies.map((movie) => {
        const liked = likedByMovieId[movie._id] ?? false;

        return (
          <article key={movie._id} className="movie">
            <Link className="movie-link" to={`/movie/${movie._id}`}>
              <img src={movie.posterUrl} alt={movie.title} />
              <h3>{movie.title}</h3>
            </Link>
            <button
              className={liked ? 'movie-like is-liked' : 'movie-like'}
              type="button"
              aria-pressed={liked}
              disabled={pendingMovieIds.has(movie._id)}
              onClick={(event) => toggleLike(event, movie._id)}
            >
              👍 {liked ? 'Liked' : 'Like'}
            </button>
            {likeErrors[movie._id] && (
              <p className="movie-error" role="alert">
                {likeErrors[movie._id]}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

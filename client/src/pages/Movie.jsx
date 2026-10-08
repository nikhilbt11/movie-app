import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';

export default function Movie() {
  const { id } = useParams();
  const [movie, setMovie] = useState(null);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [liked, setLiked] = useState(false);
  const [interactionLoading, setInteractionLoading] = useState(true);
  const [interactionPending, setInteractionPending] = useState(false);
  const [interactionError, setInteractionError] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let active = true;

    setMovie(null);
    setError('');
    setComment('');
    setLiked(false);
    setInteractionLoading(true);
    setInteractionError('');
    setFeedback('');

    api(`/movies/${id}`)
      .then((data) => {
        if (active) setMovie(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });

    api(`/movies/${id}/interaction`)
      .then((data) => {
        if (!active) return;
        setComment(data.comment);
        setLiked(data.liked);
      })
      .catch((e) => {
        if (active) setInteractionError(e.message);
      })
      .finally(() => {
        if (active) setInteractionLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id]);

  const saveComment = async (event) => {
    event.preventDefault();
    setInteractionPending(true);
    setInteractionError('');
    setFeedback('');

    try {
      const data = await api(`/movies/${id}/interaction/comment`, {
        method: 'PATCH',
        body: { comment },
      });
      setComment(data.comment);
      setFeedback('Comment saved');
    } catch (e) {
      setInteractionError(e.message);
    } finally {
      setInteractionPending(false);
    }
  };

  const toggleLike = async () => {
    setInteractionPending(true);
    setInteractionError('');
    setFeedback('');

    try {
      const data = await api(`/movies/${id}/interaction/like`, {
        method: 'PATCH',
      });
      setLiked(data.liked);
    } catch (e) {
      setInteractionError(e.message);
    } finally {
      setInteractionPending(false);
    }
  };

  if (error) return <p className="empty">{error} <Link to="/">Back to movies</Link></p>;
  if (!movie) return <p className="empty">Loading…</p>;

  return (
    <div className="watch">
      <video controls preload="metadata" poster={movie.posterUrl} src={movie.videoUrl} />
      <h2>{movie.title}</h2>
      <p>{movie.description}</p>
      <a className="btn" href={movie.downloadUrl}>Download movie</a>
      <div className="note">If the video won't play in your browser, use Download and open it in VLC.</div>
      <section className="interaction box" aria-labelledby="interaction-heading">
        <h2 id="interaction-heading">Movie Interaction</h2>
        {interactionLoading ? (
          <p className="note" role="status">Loading interaction…</p>
        ) : (
          <>
            <button
              className={liked ? 'interaction-like is-liked' : 'interaction-like'}
              type="button"
              aria-pressed={liked}
              disabled={interactionPending}
              onClick={toggleLike}
            >
              👍 {liked ? 'Liked' : 'Like'}
            </button>
            <form onSubmit={saveComment}>
              <label htmlFor="movie-comment">Comment</label>
              <textarea
                id="movie-comment"
                maxLength={1000}
                value={comment}
                disabled={interactionPending}
                onChange={(event) => {
                  setComment(event.target.value);
                  setFeedback('');
                }}
              />
              <button type="submit" disabled={interactionPending}>
                {interactionPending ? 'Saving…' : 'Save Comment'}
              </button>
            </form>
          </>
        )}
        {interactionError && <p className="msg err" role="alert">{interactionError}</p>}
        {feedback && <p className="msg ok" role="status">{feedback}</p>}
      </section>
    </div>
  );
}

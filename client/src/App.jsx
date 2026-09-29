import { Link, Route, Routes } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Movie from './pages/Movie.jsx';
import Admin from './pages/Admin.jsx';

export default function App() {
  return (
    <>
      <header>
        <Link to="/"><h1>My Movies</h1></Link>
        <Link className="nav" to="/admin">Admin</Link>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/movie/:id" element={<Movie />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<p className="empty">Page not found. <Link to="/">Back to movies</Link></p>} />
        </Routes>
      </main>
    </>
  );
}

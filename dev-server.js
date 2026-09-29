// Local development only. On Vercel, api/index.js is used directly.
import app from './api/index.js';
app.listen(3001, () => console.log('API running on http://localhost:3001'));

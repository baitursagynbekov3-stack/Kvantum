# Backend Deploy (PostgreSQL + Prisma)

This project uses a static frontend on GitHub Pages and an Express API backend.

## 1. Deploy backend (Render/Railway)

1. Create a new Web Service from this repository.
2. Use:
   - Build command: `npm install`
   - Start command: `npm run prisma:deploy && npm start`
3. Set environment variables:
   - `DATABASE_URL`: PostgreSQL connection string
   - `JWT_SECRET`: long random string
   - `ALLOWED_ORIGINS`: `https://baitursagynbekov3-stack.github.io`
   - `ADMIN_EMAILS`: comma-separated admin emails (example: `baitursagynbekov3@gmail.com`)
   - `SERVE_STATIC`: `false`

## 2. Connect frontend to backend

1. Open `public/config.js`.
2. Set API base URL:

```js
window.KVANTUM_API_BASE_URL = 'https://your-backend-domain.onrender.com';
window.KVANTUM_USE_DEMO_API = false;
```

3. Commit and push to `main`.

## 3. Verify

- Backend health: `https://your-backend-domain.onrender.com/api/health`
- Frontend: `https://baitursagynbekov3-stack.github.io/Demo-site-Kvantum/`
- Register/Login should now use PostgreSQL via Prisma.

## 4. Local setup

1. Copy `.env.example` to `.env`
2. Put a valid local PostgreSQL URL into `DATABASE_URL`
3. Run:

```bash
npm install
npm run prisma:deploy
npm run dev
```

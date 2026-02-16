# Backend Deploy (PostgreSQL + Prisma + AI Chat)

This project uses a static frontend on GitHub Pages and an Express API backend.

## 1. Deploy backend (Render/Railway/Vercel)

1. Create a new service from this repository.
2. Use:
   - Build command: `npm install`
   - Start command: `npm run prisma:deploy && npm start`
3. Set environment variables:
   - `DATABASE_URL`: PostgreSQL connection string
   - `JWT_SECRET`: long random string
   - `ALLOWED_ORIGINS`: `https://baitursagynbekov3-stack.github.io`
   - `ADMIN_EMAILS`: comma-separated admin emails (example: `baitursagynbekov3@gmail.com`)
   - `SERVE_STATIC`: `false`
   - `OPENAI_API_KEY`: OpenAI API key for real chatbot replies
   - `OPENAI_MODEL`: model name (example: `gpt-4o-mini`)
   - `TELEGRAM_BOT_TOKEN`: Telegram bot token for lead notifications
   - `TELEGRAM_CHAT_ID`: Telegram chat/channel id to receive leads

## 2. Connect frontend to backend

1. Open `public/config.js`.
2. Set API base URL:

```js
window.QUANTUM_API_BASE_URL = 'https://your-backend-domain.onrender.com';
window.QUANTUM_USE_DEMO_API = false;
```

3. Commit and push to `main`.

## 3. Verify

- Backend health: `https://your-backend-domain.onrender.com/api/health`
- Frontend: `https://baitursagynbekov3-stack.github.io/Demo-site-Kvantum/`
- Chatbot endpoint: `POST /api/chat`
- Register/Login should use PostgreSQL via Prisma.
- New consultation leads (form + chatbot) should appear in `/api/admin/overview` and Telegram (if configured).

## 4. Local setup

1. Copy `.env.example` to `.env`
2. Fill required values (`DATABASE_URL`, `JWT_SECRET`; optional but recommended: `OPENAI_API_KEY`, `TELEGRAM_*`)
3. Run:

```bash
npm install
npm run prisma:deploy
npm run dev
```

## 5. Update chatbot knowledge

- Edit `data/chat-knowledge-base.md` to adjust FAQs, wording, and business rules.
- Commit and redeploy backend after changes.
- Keep prices and policies in this file up to date; the AI prompt uses it as source of truth.

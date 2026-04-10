# Insta Rater

A web app where you submit Instagram post URLs and a partner reviews them as Good or Bad.

## Tech Stack

- **Next.js 16** (App Router, React Server Components, Server Actions)
- **TypeScript**
- **PostgreSQL** via Docker Compose
- **Prisma** ORM (v7)
- **NextAuth.js** (v5 beta) with credentials auth
- **Tailwind CSS** + **shadcn/ui**
- **Zod** for validation

## Setup

### 1. Clone and install

```bash
npm install
```

### 2. Start the database

```bash
docker compose up -d
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env if needed (defaults work with the Docker setup)
```

### 4. Run migrations and seed

```bash
npx prisma migrate dev
npm run db:seed
```

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Demo Accounts

| Role      | Email                  | Password    |
|-----------|------------------------|-------------|
| Submitter | submitter@example.com  | password123 |
| Reviewer  | reviewer@example.com   | password123 |

## Features

- **Submitter** can paste Instagram URLs with optional notes
- **Reviewer** sees all links and can rate them Good or Bad
- Optimistic UI updates for instant feedback
- Filter by rating status (Pending / Good / Bad)
- Instagram post embeds with URL fallback
- Duplicate link detection
- Mobile-responsive card grid layout

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run db:seed` | Seed demo users |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:studio` | Open Prisma Studio |

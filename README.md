# MivaFix — University Maintenance Request System

Full-stack coursework project for MIT 8333 Advanced Web Application Development.

## Stack

- Frontend: semantic HTML, CSS, vanilla JavaScript and AJAX (`fetch`)
- Backend: PHP 8+ using simple OOP classes and PDO
- Database: MySQL

## Folders

- `frontend/` — browser interface and AJAX client (`js/core.js` shared helpers, `js/auth.js` login/register, `js/app.js` application)
- `backend/` — PHP API, classes and database scripts
- `tests/` — API integration tests (`api/ApiTest.php`) and browser end-to-end tests (`ui/ui.test.mjs`), with saved output in `tests/results/`
- `docs/` — project report (`MivaFix_Project_Report.docx`), screenshots and 5-minute presentation outline

## Tests

With MySQL, the API (`:8000`) and the frontend (`:5500`) running against a freshly installed database:

```bash
php tests/api/ApiTest.php                    # 42 API integration tests
cd tests && npm install && npm run test:ui   # 25 browser tests (uses installed Google Chrome)
```

## Local setup

1. Create a MySQL database, for example `mivafix`.
2. Copy `backend/config/config.example.php` to `backend/config/config.php` and set the database credentials.
3. Install the database, tables, roles, categories, demo accounts and sample requests using PHP:

   ```bash
   php backend/database/install.php
   ```
5. Start the local demo in two separate terminals:

   ```bash
   php -S localhost:8000 backend/public/index.php
   php -S localhost:5500 -t frontend
   ```

   Then open `http://localhost:5500`. For production, configure `/api/*` to point to `backend/public/index.php` and serve `frontend/` as the document root.

## Demo accounts

All demo accounts use the password `Password123!` after running the seed script.

- Administrator: `admin@miva.test`
- Maintenance officer: `officer@miva.test`
- Student/staff: `student@miva.test`

## Main API routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/dashboard`
- `GET /api/notifications`
- `POST /api/notifications/read`
- `GET|POST /api/requests`
- `GET|PATCH|DELETE /api/requests/{id}`
- `GET /api/requests/{id}/evidence`
- `POST /api/requests/{id}/assign`
- `POST /api/requests/{id}/status`
- `GET /api/users`
- `GET /api/officers`
- `GET /api/export/requests.csv?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/export/requests.pdf?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/docs`

# Backend

The API is written in PHP 8+ with PDO, MySQL and small OOP classes. The public entry point is `public/index.php`.

## Database installation

After configuring `config/config.php`, run this from the repository root:

```bash
php backend/database/install.php
```

The installer creates the database if it does not exist, imports the schema and runs the seed data. It uses PHP PDO instead of the MySQL command-line client, which avoids local client/server authentication-plugin mismatches.

## Quick development server

From the repository root, after configuring MySQL, run the API router:

```bash
php -S localhost:8000 backend/public/index.php
```

In a second terminal, serve the frontend with:

```bash
php -S localhost:5500 -t frontend
```

Then open `http://localhost:5500`. Keep both terminals running.

Uploaded evidence images are stored in `backend/uploads/` with generated filenames. The PHP process must have write permission to that folder. Evidence is served through the authenticated `/api/requests/{id}/evidence` endpoint.

For a real deployment, configure the web server so `/api/*` points to `backend/public/index.php` and serve `frontend/` as the document root.

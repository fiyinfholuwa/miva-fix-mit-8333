# Frontend

The MivaFix browser client uses HTML, CSS and vanilla JavaScript. All server communication is performed with AJAX requests through `fetch()`.

Pages:

- `login.html` — sign in and demo account access
- `register.html` — new student/staff registration
- `index.html` — authenticated overview page
- `requests.html` — request history and officer work queue
- New requests open as a modal from `index.html` or `requests.html`
- `admin.html` — administrator request and user management page

The request modal supports validated image evidence uploads. The notification bell opens in-app updates, and authenticated pages poll for dashboard/request changes every ten seconds.

# 213 SERVER isolated preview

Open `preview.html` for the login-free synthetic-data UI, or `preview.html?view=migration` to review migration management directly. `index.html` contains the same preview. The operating login form and sign-in calls are removed; startup failures show a preview error message instead.

No operating credentials, backend URLs, persistent storage or external transports. Migration actions affect generated data in browser memory only; reloading resets those changes. Other operating writes remain blocked. The main operating branch is not part of this preview deployment.

See `release-audit.html` for tested scope and remaining operating-environment checks.

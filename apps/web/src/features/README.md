# Features

Screen-level modules: data fetching, composition and screen state (docs/design-system/26-implementation-guidelines.md section 2). One folder per feature. A feature never imports another feature.

This folder exists before the first feature does because src/styles/app.css names it as a Tailwind source: the dev server only watches source folders that exist when it starts.

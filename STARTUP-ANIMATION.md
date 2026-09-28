# v6.2 Cinematic Startup Experience

The app opens with a realistic, single-scene-at-a-time cinematic sequence before authentication.

- Five full-screen household scenes crossfade automatically every 1.8 seconds
- Each scene uses a slow Ken Burns camera move for depth and realism
- Subtle light/haze/film-grain layers create a cinematic look without video dependencies
- Scene dots let the user manually move through the intro
- Progress indicator and scene-specific copy animate with the experience
- Large Start button remains at the bottom and opens the existing Login/Create House/Join House screen
- The intro runs once per browser session via sessionStorage
- Respects `prefers-reduced-motion`

Cinematic source assets:
- `frontend/public/cinematic/scene-clean.jpg`
- `frontend/public/cinematic/scene-cook.jpg`
- `frontend/public/cinematic/scene-dishes.jpg`
- `frontend/public/cinematic/scene-water.jpg`
- `frontend/public/cinematic/scene-people.jpg`

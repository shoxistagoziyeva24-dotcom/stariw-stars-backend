# Stariw Stars Backend

This small Node service is the Telegram seller-session backend. Deploy it on a normal Node host (Render/Railway/Fly/etc.), not Netlify Functions.

Environment variables:
- TG_API_ID
- TG_API_HASH
- TG_SESSION
- STARS_BACKEND_SECRET

Start: `npm install && npm start`

Then set in Netlify:
- STARS_BACKEND_URL = your HTTPS service URL
- STARS_BACKEND_SECRET = the same secret

The Netlify order function checks customer available balance, checks seller Stars, freezes the UZS amount in `reservedBalance`, requests delivery, and only after successful Telegram delivery converts the frozen amount into a real charge. On delivery failure the reservation is released.

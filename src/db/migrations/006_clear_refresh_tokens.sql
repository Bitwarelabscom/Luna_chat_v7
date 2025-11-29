-- One-time rotation of all refresh tokens after security fix
TRUNCATE TABLE refresh_tokens;

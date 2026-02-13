# Jellyfin + yt-dlp Integration Setup Guide

## Overview

Luna now supports both YouTube search AND local Jellyfin media library search, with the ability to download YouTube videos to your local library via yt-dlp.

## Configuration

### 1. YouTube Cookies (Optional but Recommended)

To avoid rate limiting and geo-blocking, add YouTube cookies to yt-dlp:

**Option 1: Extract from browser**
```bash
# If you have yt-dlp locally with extracted cookies:
cp ~/.config/yt-dlp/cookies.txt /opt/luna-chat/secrets/youtube_cookies.txt
docker compose up -d luna-api
```

**Option 2: Generate cookies**
- Use a tool like [yt-dlp-cookies](https://github.com/coletdjnz/yt-dlp-cookies) or browser extension to extract YouTube cookies
- Save to `/opt/luna-chat/secrets/youtube_cookies.txt` in Netscape HTTP Cookie File format
- Restart: `docker compose up -d luna-api`

**Without cookies:** Downloads still work but may be rate-limited or blocked by YouTube.

### 2. Jellyfin Configuration

Jellyfin is expected to run on `localhost:8096`:
- **URL:** `http://host.docker.internal:8096` (from container perspective)
- **Username:** `luna` (default, override with `JELLYFIN_USERNAME` env var)
- **Password:** Stored in Docker secret `jellyfin_password` (set your own secure password)

To set/change the password:
```bash
echo "YOUR_SECURE_PASSWORD_HERE" > /opt/luna-chat/secrets/jellyfin_password.txt
docker compose up -d luna-api
```

### 3. Media Directories

Downloads automatically save to:
- **Videos:** `/mnt/data/media/Videos/` (mp4 format)
- **Music:** `/mnt/data/media/Music/` (mp3 format)

These directories are shared with Jellyfin. After a download completes, yt-dlp automatically triggers a Jellyfin library scan so new files appear immediately.

## Usage

### Search Local Library

```
Luna: "Play some rock music"
Luna calls: jellyfin_search(query="rock", mediaType="audio")
Result: Local music library search, displayed in unified media player
```

### Search YouTube

```
Luna: "Show me a music video"
Luna calls: youtube_search(query="music video")
Result: YouTube results, displayed in unified media player
```

### Download Video

In the media player, YouTube items show download buttons:
- **"Download Video"** → Saves as mp4 to `/mnt/data/media/Videos/`
- **"Download Music"** → Extracts audio as mp3 to `/mnt/data/media/Music/`

The button shows progress and changes to "Saved" when complete. Jellyfin library scans automatically.

## File Structure

```
Backend:
  src/abilities/
    - jellyfin.service.ts      (Jellyfin API client)
    - ytdlp.service.ts         (Download service)
    - download.routes.ts       (REST API endpoints)
  src/chat/
    - chat.service.ts          (Tool handlers + SSE)
    - chat.routes.ts           (SSE forwarding)

Frontend:
  frontend/src/lib/
    - window-store.ts          (MediaItem + PendingMediaData)
    - store.ts                 (MediaAction interface)
    - api.ts                   (mediaApi client)
  frontend/src/components/
    - os/apps/VideosWindow.tsx (Unified player)
    - ChatArea.tsx             (Handle media_action chunks)
    - os/Desktop.tsx           (Watch mediaAction, open player)

Secrets:
  secrets/jellyfin_password.txt
  secrets/youtube_cookies.txt
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JELLYFIN_URL` | `http://host.docker.internal:8096` | Jellyfin server URL |
| `JELLYFIN_USERNAME` | `luna` | Jellyfin username |
| `JELLYFIN_ENABLED` | `true` | Enable Jellyfin integration |
| `MEDIA_VIDEO_PATH` | `/mnt/data/media/Videos` | Video download directory |
| `MEDIA_MUSIC_PATH` | `/mnt/data/media/Music` | Audio download directory |
| `YTDLP_COOKIES_PATH` | `/app/secrets/youtube_cookies.txt` | Cookie file path |

## LLM Tools

### `jellyfin_search`
Search the local Jellyfin library.

**Parameters:**
- `query` (required): Search term
- `mediaType` (optional): `'audio'`, `'video'`, `'all'` (default: `'all'`)
- `limit` (optional): Results count, max 10 (default: 5)

### `jellyfin_play`
Play a specific item from Jellyfin.

**Parameters:**
- `itemId` (required): Jellyfin item ID
- `itemName` (required): Display name

### `media_download`
Download a YouTube video to the local media library.

**Parameters:**
- `videoId` (required): YouTube video ID
- `title` (required): Video title (used for filename)
- `format` (required): `'video'` (mp4) or `'audio'` (mp3)

## Troubleshooting

### Downloads fail immediately
- Check that `/mnt/data/media/{Videos,Music}/` directories exist and are writable
- Verify yt-dlp is installed: `docker exec luna-api yt-dlp --version`
- Check logs: `docker logs luna-api | grep -i download`

### Jellyfin search returns no results
- Verify Jellyfin is running: `curl http://localhost:8096/web/`
- Check connection: `docker exec luna-api wget -q -O- http://host.docker.internal:8096/System/Info`
- Verify auth: `docker logs luna-api | grep -i jellyfin`

### Downloaded files don't appear in Jellyfin
- Manually trigger scan: Jellyfin web interface → Administration → Scheduled Tasks → Library Scan
- Or restart Jellyfin to force rescan
- Check file permissions in `/mnt/data/media/`

### Rate limiting when downloading
- Add YouTube cookies (see Configuration section above)
- yt-dlp will automatically use them if file exists

## Build & Deployment

```bash
# Build backend
npm run build:prod

# Build frontend
cd frontend && npm run build && cd ..

# Rebuild Docker images
docker compose build luna-api luna-frontend

# Restart containers
docker compose up -d luna-api luna-frontend
```

All code is compiled into the Docker images - no volume mounting of source code.

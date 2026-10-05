# Scream – Firebase Deployment Guide

## Architecture

- **Firebase Hosting**: React client (built from `client/`)
- **Firebase Cloud Functions**: API backend (auth, queue, routing, Daily rooms)
- **Cloud Firestore**: Staff accounts, call queue, active calls
- **Firebase Realtime Database**: Real-time call status notifications
- **Daily.co**: Audio transport (WebRTC, NAT/TURN handled)

## Prerequisites

1. **Firebase account**: https://console.firebase.google.com
2. **Daily.co API key**: https://dashboard.daily.co
3. **Firebase CLI**: `npm install -g firebase-tools`

## Setup Steps

### 1. Create Firebase Project

```bash
# Login to Firebase
firebase login

# Initialize the project (from /scream directory)
firebase init
```

When prompted:
- **Firestore**: Use existing rules (`firebase/firestore.rules`)
- **Functions**: Use `firebase/functions` as source, Node.js 20
- **Hosting**: Use `client/build` as public directory, yes to SPA rewrite
- **Ignore**: Press Ctrl+C to skip other services

### 2. Enable Required Services

In Firebase Console:
1. **Firestore Database** → Create database (production mode)
2. **Realtime Database** → Create database (choose region)
3. **Cloud Functions** → Already enabled by init

### 3. Create Staff Account (one-time)

Use the admin panel or Firebase Console:

```bash
# Via Firebase Console → Firestore → staff collection → Add document
# ID: admin
# Fields:
#   employeeId: "admin" (string)
#   password: "admin123temp" (string)
#   role: "admin" (string)
#   active: true (boolean)
#   status: "away" (string)
#   createdAt: (server timestamp)
```

### 4. Configure Daily.co API Key

```bash
# Set the Daily API key for Cloud Functions
firebase functions:config:set daily.api_key="YOUR_DAILY_API_KEY"
```

### 5. Build & Deploy

```bash
# Build the React client
npm run build

# Deploy everything
firebase deploy
```

Or deploy individual services:

```bash
# Deploy only hosting
firebase deploy --only hosting

# Deploy only functions
firebase deploy --only functions

# Deploy only Firestore rules
firebase deploy --only firestore
```

### 6. Set Environment Variables (optional)

For the client (Firebase Hosting):

```bash
# In client/.env
REACT_APP_FIREBASE_API_KEY=your_api_key
REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
REACT_APP_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
REACT_APP_FIREBASE_PROJECT_ID=your-project
REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
REACT_APP_FIREBASE_SENDER_ID=your_sender_id
REACT_APP_FIREBASE_APP_ID=your_app_id
```

Then rebuild: `npm run build && firebase deploy --only hosting`

## URL Structure

- **Caller**: `https://your-project.web.app`
- **Staff**: `https://your-project.web.app/#staff`
- **Admin**: `https://your-project.web.app/#admin`

## Cost Estimate (Free Tier)

| Service | Free Tier |
|---------|-----------|
| Firebase Hosting | 10 GB/month |
| Cloud Functions | 2M invocations/month |
| Firestore | 1 GB storage, 50K reads/day |
| Realtime Database | 1 GB storage |
| Daily.co | 10,000 min/month (1:1 voice) |

**Total: $0/month** for moderate usage.

## Troubleshooting

### Functions not deploying
```bash
# Check logs
firebase functions:log

# Check function config
firebase functions:config:get
```

### Daily room creation fails
```bash
# Verify API key is set
firebase functions:config:get

# Test locally
firebase emulators:start
```

### Realtime Database not connecting
- Check that RTDB is enabled in Firebase Console
- Verify the databaseURL in `client/src/firebase.js`
- Check RTDB rules (should allow public read/write for this app)

### Audio not flowing
- Check Daily.co dashboard for room activity
- Verify both caller and staff have mic permissions
- Check browser console for WebRTC errors

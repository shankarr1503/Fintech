# Third-party licences

CoinQuest's own code, the app icon, the coin and other illustrations were made for this project. The rest are open-source components whose licences allow commercial use. Each package ships its full licence text. The app shows the same list under **Legal → Licences**.

## Fonts and icons

| Asset | Licence | Notice |
|---|---|---|
| Pixelify Sans | SIL Open Font License 1.1 | Copyright 2021 The Pixelify Sans Project Authors (https://github.com/eifetx/Pixelify-Sans). No Reserved Font Name. Modified: `frontend/scripts/build-fonts.py` adds the ₹ sign and four arrows; the modified files are distributed under the same licence |
| Feather icons (via @expo/vector-icons) | MIT | Copyright (c) 2013-2017 Cole Bemis |

The font files are bundled with the app (`frontend/assets/fonts`); they are not loaded from Google's servers at runtime. The upstream files come from `@expo-google-fonts/pixelify-sans`, a build-time dev dependency.

## App (frontend/package.json)

Regenerate this list with `node frontend/scripts/licenses.js`.

| Package | Version | Licence |
|---|---|---|
| @expo/vector-icons | 15.0.3 | MIT |
| @react-native-async-storage/async-storage | 2.2.0 | MIT |
| @react-native-community/netinfo | 11.4.1 | MIT |
| @react-navigation/bottom-tabs | 7.20.0 | MIT |
| @react-navigation/elements | 2.9.44 | MIT |
| @react-navigation/native | 7.5.0 | MIT |
| @react-navigation/native-stack | 7.20.0 | MIT |
| axios | 1.13.2 | MIT |
| expo | 54.0.37 | MIT |
| expo-blur | 15.0.8 | MIT |
| expo-camera | 17.0.10 | MIT |
| expo-constants | 18.0.14 | MIT |
| expo-device | 8.0.10 | MIT |
| expo-font | 14.0.12 | MIT |
| expo-haptics | 15.0.8 | MIT |
| expo-linear-gradient | 15.0.8 | MIT |
| expo-linking | 8.0.12 | MIT |
| expo-local-authentication | 17.0.9 | MIT |
| expo-notifications | 0.32.17 | MIT |
| expo-router | 6.0.24 | MIT |
| expo-secure-store | 15.0.8 | MIT |
| expo-splash-screen | 31.0.13 | MIT |
| expo-status-bar | 3.0.9 | MIT |
| expo-system-ui | 6.0.9 | MIT |
| react | 19.1.0 | MIT |
| react-dom | 19.1.0 | MIT |
| react-native | 0.81.5 | MIT |
| react-native-gesture-handler | 2.28.0 | MIT |
| react-native-reanimated | 4.1.7 | MIT |
| react-native-safe-area-context | 5.6.2 | MIT |
| react-native-screens | 4.16.0 | MIT |
| react-native-svg | 15.12.1 | MIT |
| react-native-web | 0.21.3 | MIT |
| react-native-worklets | 0.5.1 | MIT |

## Server (backend/requirements.txt)

| Package | Licence |
|---|---|
| fastapi | MIT |
| uvicorn | BSD-3-Clause |
| motor | Apache-2.0 |
| mongomock-motor | MIT |
| pydantic | MIT |
| python-dotenv | BSD-3-Clause |
| python-multipart | Apache-2.0 |
| openai | Apache-2.0 |
| pyjwt | MIT |
| cryptography | Apache-2.0 OR BSD-3-Clause |
| httpx | BSD-3-Clause |

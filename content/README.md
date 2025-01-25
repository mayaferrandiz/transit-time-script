# Setup

1. Replace the following variables at the top of your script with actual values. Calendar IDs are available in the settings section of Google Calendar.
```javascript
const SOURCE_CALENDAR_ID = 'INSERT PRIMARY CALENDAR ID'; // Your primary calendar ID
const DESTINATION_CALENDAR_ID = 'INSERT DESTINATION CALENDAR ID'; // Replace with transit calendar ID
const MAPS_API_KEY = 'INSERT MAPS API KEY'; // Replace with your Maps API key

const HOME_ADDRESS = 'INSERT HOME ADDRESS'; // Replace with your home address
```

2. Create a new Oauth scope in Google Cloud Platform to grant the script access to your calendar

3. Create a new Apps Script project. Paste in the code with your variables inserted.

4. Set up the following triggers
- onDailyUpdate - Daily trigger
- onCalendarUpdate - Calendar updated trigger
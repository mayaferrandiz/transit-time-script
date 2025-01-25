const SOURCE_CALENDAR_ID = 'INSERT PRIMARY CALENDAR ID'; // Your primary calendar ID
const DESTINATION_CALENDAR_ID = 'INSERT DESTINATION CALENDAR ID'; // Replace with transit calendar ID
const MAPS_API_KEY = 'INSERT MAPS API KEY'; // Replace with your Maps API key

const HOME_ADDRESS = 'INSERT HOME ADDRESS'; // Replace with your home address
const DEFAULT_TRANSIT_MODE = 'transit'; // Options: 'driving', 'walking', 'bicycling', 'transit'

const LOOK_FORWARD_WINDOW_DAYS = 28; //number of days out to create transit events
const LOOK_FORWARD_WINDOW_MILLISECONDS = LOOK_FORWARD_WINDOW_DAYS * 24 * 60 * 60 * 1000

const CACHE_SCRIPT_BUFFER_TIME = 1 * 60 * 1000 //how long before cache expires to run scripts that are run right before cache expires

const EVENT_DATE_CACHE_KEY = 'eventDateCache';  // Global cache key for event details so that we can track event date for events that might get cancelled in the future
const EVENT_DATE_CACHE_EXPIRY_MILLISECONDS = 6 * 60 * 60 * 1000; //6 hours. How long to expire cache for event dates
const EVENT_DATE_CACHE_REFRESH_AFTER_MILLISECONDS = EVENT_DATE_CACHE_EXPIRY_MILLISECONDS - CACHE_SCRIPT_BUFFER_TIME //when to run script to refresh cache after cache has just been set

const BATCH_PROCESSING_CACHE_KEY = 'batchProcessCache'; // Global key for the calendar date cache for batch processing
const BATCH_PROCESSING_RUN_AFTER_MILLISECONDS = 5 * 60 * 1000; //How long after initial onCalendarUpdate trigger to wait before running batch job, during which events can continue to be added to cache
const BATCHING_CACHE_EXPIRY_MILLISECONDS = BATCH_PROCESSING_RUN_AFTER_MILLISECONDS + CACHE_SCRIPT_BUFFER_TIME //When to expire cache for dates held in batch job cache

function onCalendarUpdate() {
  const today = new Date();
  const timeMax = new Date(today.getTime() + LOOK_FORWARD_WINDOW_MILLISECONDS); //LOOK_FORWARD_WINDOW days from now
  const updatedMin = new Date(today.getTime() - 6 * 60 * 60 * 1000); //get events that were updated within the last 6 hours

  const events = Calendar.Events.list(SOURCE_CALENDAR_ID, {
    timeMin: today.toISOString(),
    timeMax: timeMax.toISOString(),
    updatedMin: updatedMin.toISOString(),
    singleEvents: true,
    orderBy: 'updated'
  });

  if (events.items && events.items.length > 0) {
    // Get the most recently updated event (last item in the sorted list)
    const mostRecentEvent = events.items[events.items.length - 1];
    let eventDate;

    try {
      if (mostRecentEvent.status !== 'cancelled'){
        eventDate = new Date(mostRecentEvent.start.dateTime || mostRecentEvent.start.date);
        setEventDateToCache(mostRecentEvent.id, eventDate);
        removeTimedReminders(SOURCE_CALENDAR_ID, mostRecentEvent.id);
      } else {
        eventDate = new Date( getEventDateFromCache(mostRecentEvent.id) );
      }
      cacheDateForBatchProcess(eventDate);
      scheduleBatchUpdate();
    } catch (e) {
      console.error("Error processing the most recent event:", e.message);
    }
  }
}

function removeTimedReminders(calendarId, eventId) {
  try {
    // Fetch the event
    const event = Calendar.Events.get(calendarId, eventId);

    if (event.reminders && event.reminders.overrides) {
      // Filter out timed reminders (e.g., "popup" or "email")
      const updatedOverrides = event.reminders.overrides.filter(reminder => reminder.method !== "popup");

      // Update the event's reminders
      event.reminders.overrides = updatedOverrides;

      // Save changes
      Calendar.Events.update(event, calendarId, eventId);
      console.log(`Timed reminders removed for event: ${event.summary}`);
    } else {
      console.log("No custom timed reminders to remove.");
    }
  } catch (error) {
    console.error(`Failed to update event reminders: ${error.message}`);
  }
}

function refreshEventDateCache(){
  const today = new Date();
  const timeMax = new Date(today.getTime() + LOOK_FORWARD_WINDOW_MILLISECONDS);
  const eventDetailsCache = {}

  const events = Calendar.Events.list(SOURCE_CALENDAR_ID, {
    timeMin: today.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
  });

  events.items.forEach(event => {
    if (event.status !== 'cancelled'){
      eventDetailsCache[event.id] = new Date(event.start.dateTime || event.start.date);
    }
  })

  const cache = CacheService.getScriptCache();
  cache.put(EVENT_DATE_CACHE_KEY, JSON.stringify(eventDetailsCache), EVENT_DATE_CACHE_EXPIRY_MILLISECONDS);
  scheduleEventCacheRefresh();
}

function scheduleEventCacheRefresh(){
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach((trigger) => {
    if (trigger.getHandlerFunction() === 'refreshEventDateCache') {
      ScriptApp.deleteTrigger(trigger)
    }
  });
  console.log('Scheduling event date cache refresh');
  ScriptApp.newTrigger('refreshEventDateCache')
    .timeBased()
    .after(EVENT_DATE_CACHE_REFRESH_AFTER_MILLISECONDS)
    .create();
}

function setEventDateToCache(eventId, date) {
  const cache = CacheService.getScriptCache();
  const cachedEventData = cache.get(EVENT_DATE_CACHE_KEY);
  const eventDetailsCache = cachedEventData ? JSON.parse(cachedEventData) : {};

  eventDetailsCache[eventId] = date.toISOString();
  cache.put(EVENT_DATE_CACHE_KEY, JSON.stringify(eventDetailsCache), EVENT_DATE_CACHE_EXPIRY_MILLISECONDS);
  console.log(`Added event ID: ${eventId} with date: ${date} to event details cache.`);
  scheduleEventCacheRefresh();
}

function getEventDateFromCache(eventId){
  const cache = CacheService.getScriptCache();
  const cachedEventData = cache.get(EVENT_DATE_CACHE_KEY);
  const eventDetailsCache = cachedEventData ? JSON.parse(cachedEventData) : {};
  return eventDetailsCache[eventId];
}

function deleteEventDateFromCache(eventId){
  const cache = CacheService.getScriptCache();
  const cachedEventData = cache.get(EVENT_DATE_CACHE_KEY);
  const eventDetailsCache = cachedEventData ? JSON.parse(cachedEventData) : {};
  delete eventDetailsCache[eventId]
  cache.put(EVENT_DATE_CACHE_KEY, JSON.stringify(eventDetailsCache), EVENT_DATE_CACHE_EXPIRY_MILLISECONDS);
  console.log(`Deleted event ID: ${eventId} from event details cache.`);
  scheduleEventCacheRefresh();
}

function cacheDateForBatchProcess(date) {
  const cache = CacheService.getScriptCache();
  const cachedDates = cache.get(BATCH_PROCESSING_CACHE_KEY);
  const datesSet = cachedDates ? new Set(JSON.parse(cachedDates)) : new Set();

  const dateKey = new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
  if (!datesSet.has(dateKey)) {
    datesSet.add(dateKey);
    cache.put(BATCH_PROCESSING_CACHE_KEY, JSON.stringify(Array.from(datesSet)), BATCHING_CACHE_EXPIRY_MILLISECONDS);
    console.log(`Added date ${dateKey} to cache for batch processing.`);
  } else {
    console.log(`Date ${dateKey} is already in batch processing cache.`);
  }
}

function scheduleBatchUpdate() {
  const triggers = ScriptApp.getProjectTriggers();
  let shouldScheduleUpdate = true;
  triggers.forEach((trigger) => {
    if (trigger.getHandlerFunction() === 'processBatchUpdate') {
      shouldScheduleUpdate = false;
    }
  });

  if (shouldScheduleUpdate){
    console.log('Scheduling batch process job');
    ScriptApp.newTrigger('processBatchUpdate')
      .timeBased()
      .after(BATCH_PROCESSING_RUN_AFTER_MILLISECONDS)
      .create();
  } else {
    console.log('Batch process already scheduled');
  }
}

function processBatchUpdate() {
  const cache = CacheService.getScriptCache();
  const cachedDates = cache.get(BATCH_PROCESSING_CACHE_KEY);
  const updates = cachedDates ? JSON.parse(cachedDates) : [];
  
  cache.remove(BATCH_PROCESSING_CACHE_KEY);
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach((trigger) => {
    if (trigger.getHandlerFunction() === 'processBatchUpdate') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  console.log(`Date cache: ${updates}`);

  updates.forEach(day => {
    const date = new Date(day);
    console.log(`Processing from cache for ${date}`);
    try {
      deleteOldTransitEvents(date); // Clear existing transit events for the day
      addTransitEvents(date);  // Add new transit events for the day
    } catch (e) {
      console.error(`Error processing transit events for ${day}:`, e.message);
    }
  });

  console.log('✅ Completed batch update');
}

function onDailyUpdate() {
  const today = new Date();
  const targetDate = new Date(today.getTime() + LOOK_FORWARD_WINDOW_MILLISECONDS);
  addTransitEvents(targetDate);
  console.log('✅ Completed daily update');
}

function resetTransitEvents() {
  for (i = 0; i < LOOK_FORWARD_WINDOW_DAYS; i++){
    let targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + i);
    addTransitEvents(targetDate);
  }
}

function deleteOldTransitEvents(targetDate) {
  const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
  const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

  const events = CalendarApp.getCalendarById(DESTINATION_CALENDAR_ID)
    .getEvents(startOfDay, endOfDay);

  events.forEach(event => {
    event.deleteEvent();
    console.log(`Deleted old transit event: ${event.getTitle()}`);
  });
}

function addTransitEvents(targetDate) {
  deleteOldTransitEvents(targetDate);

  const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
  const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

  const events = Calendar.Events.list(SOURCE_CALENDAR_ID, {
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    showDeleted: false,
    singleEvents: true,
    orderBy: 'startTime'
  });

  const eventsWithLocation = events.items.filter(e => e.location && e.location.length > 0)

  let lastLocation = HOME_ADDRESS;
  let lastEventName = "Home";

  for (let i = 0; i < eventsWithLocation.length; i++) {
    const currentEvent = eventsWithLocation[i];
    const currentLocation = currentEvent.location;
    const currentTitle = areLocationsSimilar(HOME_ADDRESS, currentLocation) ? "Home" : currentEvent.summary;
    const transitEndTime = new Date(currentEvent.start.dateTime || currentEvent.start.date)

    if (!areLocationsSimilar(lastLocation, currentLocation)) {
      const transitDuration = calculateTransitTime(lastLocation, currentLocation, transitEndTime);

      if (transitDuration && transitDuration <= 3 * 60 * 60) {
        const roundedTransitDuration = Math.ceil(transitDuration / 900) * 900;
        const transitStartTime = new Date(transitEndTime.getTime() - roundedTransitDuration * 1000);

        createTransitEvent(
          `${lastEventName} > ${currentTitle}`,
          lastEventName,
          lastLocation,
          currentTitle,
          currentLocation,
          transitStartTime,
          transitEndTime
        );
      }
    }

    lastLocation = currentLocation;
    lastEventName = currentTitle;

    // Create transit event back home if this is the last event of the day
    if (i === eventsWithLocation.length - 1) {
      const homeTransitStartTime = new Date(currentEvent.end.dateTime || currentEvent.end.date)

      if (!areLocationsSimilar(currentLocation, HOME_ADDRESS)) {
        const homeTransitDuration = calculateTransitTime(currentLocation, HOME_ADDRESS, homeTransitStartTime);

        if (homeTransitDuration) {
          const roundedHomeTransitDuration = Math.ceil(homeTransitDuration / 900) * 900;
          const homeTransitEndTime = new Date(homeTransitStartTime.getTime() + roundedHomeTransitDuration * 1000);

          createTransitEvent(
            `${currentTitle} > Home`,
            currentTitle,
            currentLocation,
            "Home",
            HOME_ADDRESS,
            homeTransitStartTime,
            homeTransitEndTime
          );
        }
      }
    }
  }
}

function createTransitEvent(eventTitle, originName, originLocation, destinationName, destinationLocation, startTime, endTime) {
  const appleMapsLink = `http://maps.apple.com/?saddr=${encodeURIComponent(originLocation)}&daddr=${encodeURIComponent(destinationLocation)}`;

  const event = {
    start:{
      dateTime: startTime.toISOString(),
      timeZone: "America/New_York"
    },
    end:{
      dateTime: endTime.toISOString(),
      timeZone: "America/New_York"
    },
    summary: eventTitle,
    description: `${appleMapsLink}`,
    reminders:{
      useDefault:false
    }
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${DESTINATION_CALENDAR_ID}/events`

  const response = UrlFetchApp.fetch(url, {
    method:'post',
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    payload: JSON.stringify(event)
  })

  const data = JSON.parse(response.getContentText())

  console.log(`Transit event created between ${originName} and ${destinationName}`);
}

function calculateTransitTime(origin, destination, arrivalTime) {
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&departure_time=${Math.floor(arrivalTime.getTime() / 1000)}&mode=${DEFAULT_TRANSIT_MODE}&key=${MAPS_API_KEY}`;
  
  try {
    const response = UrlFetchApp.fetch(url);
    const data = JSON.parse(response.getContentText());
    
    if (data.status !== "OK") {
      console.error(`Error fetching transit data: ${data.status}`);
      return null;
    }

    const element = data.rows[0].elements[0];
    if (element.status === "OK") {
      return element.duration.value; // Transit time in seconds
    } else if (element.status === "ZERO_RESULTS") {
      console.error(`ZERO_RESULTS: No transit data found between ${origin} and ${destination}. URL: ${url}`);
      return null;
    } else if (element.status === "NOT_FOUND") {
      console.error(`NOT_FOUND: One or both locations (${origin}, ${destination}) could not be geocoded. URL: ${url}`);
      return null;
    } else {
      console.error(`Unexpected error: ${element.status}. URL: ${url}`);
      return null;
    }
  } catch (error) {
    console.error("Error fetching transit time:", error);
    return null;
  }
}

function standardizeLocation(loc){
  return loc.toLowerCase()
    .replace(/\s+/g, '') // Remove whitespace
    .replace(/[^a-z0-9]/g, '') // Remove non-alphanumeric characters
    .replace(/\bst\b/g, 'street')
    .replace(/\bave\b/g, 'avenue')
    .replace(/\bblvd\b/g, 'boulevard')
    .replace(/\bdr\b/g, 'drive')
    .replace(/\bct\b/g, 'court')
    .replace(/\brd\b/g, 'road')
    .replace(/\bln\b/g, 'lane')
    .replace(/\bapt\b/g, 'apartment')
    .replace(/\bsuite\b/g, 'suite')
    .replace(/\bpkwy\b/g, 'parkway')
    .replace(/\bpl\b/g, 'place')
    .replace(/\btrl\b/g, 'trail')
    .replace(/\bcir\b/g, 'circle')
    .replace(/\bway\b/g, 'way')
    .replace(/\bbldg\b/g, 'building')
    .replace(/\bfwy\b/g, 'freeway');
}

function areLocationsSimilar(location1, location2) {
  if (!location1 || !location2) return false;
  
  const formattedLocation1 = standardizeLocation(location1);
  const formattedLocation2 = standardizeLocation(location2);

  return formattedLocation1.includes(formattedLocation2) || formattedLocation2.includes(formattedLocation1);
}

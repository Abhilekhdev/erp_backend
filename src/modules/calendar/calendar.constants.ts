/**
 * Calendar event types — 1:1 with GOURI's `eventTypes()` contract
 * (`HomeController@getCalendar` + `Essentials\DataController::eventTypes`).
 *
 * Colours are the exact legacy hex values so the filter chips and events look identical.
 *
 * `available` marks whether the data source exists in this rewrite yet:
 *  - holiday / leaves → the HRM tables are built, so these return real events.
 *  - bookings  → needs the Restaurant module (`bookings`, `res_tables`, contacts).
 *  - todo / reminder → need the Essentials productivity modules (`essentials_to_dos`,
 *    `essentials_reminders`), which are deferred.
 *
 * Unavailable types are still listed (so the UI shows the full legacy set and can explain the
 * gap) but never contribute events.
 */
export interface CalendarEventType {
  key: string;
  label: string;
  color: string;
  available: boolean;
  /** Shown in the UI when `available` is false. */
  requires?: string;
}

export const EVENT_TYPES: CalendarEventType[] = [
  {
    key: 'bookings',
    label: 'Bookings',
    color: '#007FFF',
    available: false,
    requires: 'Restaurant module (bookings)',
  },
  {
    key: 'todo',
    label: 'To Do',
    color: '#33006F',
    available: false,
    requires: 'Essentials To-Do module',
  },
  { key: 'holiday', label: 'Holidays', color: '#568203', available: true },
  { key: 'leaves', label: 'Leaves', color: '#BA0021', available: true },
  {
    key: 'reminder',
    label: 'Reminders',
    color: '#ff851b',
    available: false,
    requires: 'Essentials Reminders module',
  },
];

export const AVAILABLE_TYPES = EVENT_TYPES.filter((t) => t.available).map((t) => t.key);

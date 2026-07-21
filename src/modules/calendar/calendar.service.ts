import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessPayload } from '../auth/token.service';
import { AVAILABLE_TYPES, EVENT_TYPES } from './calendar.constants';
import type { CalendarQueryDto } from './dto/calendar-query.dto';

/** One normalized calendar event. */
export interface CalendarEvent {
  id: string;
  type: string;
  title: string;
  /** Second line in the event chip (GOURI's `title_html`, e.g. the leave type). */
  subtitle: string | null;
  /** YYYY-MM-DD (all-day events) — inclusive. */
  start: string;
  end: string;
  allDay: boolean;
  color: string;
  /** In-app route the event links to. */
  link: string | null;
}

const ACCESS_ALL_LOCATIONS = 'access_all_locations';
const fmt = (d: Date): string => d.toISOString().slice(0, 10);
const fullName = (u: { surname: string | null; firstName: string; lastName: string | null }): string =>
  [u.surname, u.firstName, u.lastName].filter(Boolean).join(' ').trim();

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /calendar/meta — the User + Location dropdowns and the event-type legend. */
  async meta(user: AccessPayload) {
    const businessId = user.businessId as number;
    // GOURI only renders the User select for an admin; everyone else is pinned to themselves.
    const isAdmin = user.isBusinessAdmin;

    const [users, locations] = await Promise.all([
      isAdmin
        ? this.prisma.user.findMany({
            where: { businessId, deletedAt: null },
            select: { id: true, surname: true, firstName: true, lastName: true },
            orderBy: { firstName: 'asc' },
          })
        : Promise.resolve([]),
      this.prisma.businessLocation.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      canPickUser: isAdmin,
      currentUserId: user.sub,
      users: users.map((u) => ({ id: u.id, name: fullName(u) })),
      locations: locations.map((l) => ({ id: l.id, name: l.name })),
      eventTypes: EVENT_TYPES,
    };
  }

  /**
   * GET /calendar/events — every event in the window, for the selected user/location/types.
   *
   * Scoping follows GOURI: only an admin may look at another user's calendar; everyone else is
   * forced onto their own id regardless of what the query asks for.
   */
  async events(user: AccessPayload, query: CalendarQueryDto): Promise<{ data: CalendarEvent[] }> {
    const businessId = user.businessId as number;
    const isAdmin = user.isBusinessAdmin;
    const targetUserId = isAdmin && query.userId ? query.userId : user.sub;

    // Requested types ∩ types we can actually serve.
    const requested = query.events?.length ? query.events : AVAILABLE_TYPES;
    const types = new Set(requested.filter((t) => AVAILABLE_TYPES.includes(t)));

    const start = new Date(`${query.start}T00:00:00Z`);
    const end = new Date(`${query.end}T23:59:59Z`);

    const [holidays, leaves] = await Promise.all([
      types.has('holiday') ? this.holidays(businessId, targetUserId, query.locationId, start, end) : [],
      types.has('leaves') ? this.leaves(businessId, targetUserId, start, end) : [],
    ]);

    return { data: [...holidays, ...leaves] };
  }

  /**
   * Holidays in range.
   *
   * GOURI filters on `start_date` alone (`whereDate(start_date) >= start AND <= end`), so a holiday
   * that STARTED before the visible window but is still running inside it silently disappears.
   * This uses a proper overlap test (`startDate <= windowEnd AND endDate >= windowStart`) instead.
   *
   * Location scoping is GOURI's: an explicit `location_id` wins; otherwise a non-admin sees only
   * their permitted locations plus business-wide holidays (`location_id IS NULL`).
   */
  private async holidays(
    businessId: number,
    userId: number,
    locationId: number | undefined,
    start: Date,
    end: Date,
  ): Promise<CalendarEvent[]> {
    const color = EVENT_TYPES.find((t) => t.key === 'holiday')!.color;

    let locationFilter: object = {};
    if (locationId) {
      locationFilter = { OR: [{ locationId }, { locationId: null }] };
    } else {
      const permitted = await this.permittedLocationIds(businessId, userId);
      if (permitted !== 'all') {
        locationFilter = { OR: [{ locationId: { in: permitted } }, { locationId: null }] };
      }
    }

    const rows = await this.prisma.holiday.findMany({
      where: {
        businessId,
        deletedAt: null,
        startDate: { lte: end },
        endDate: { gte: start },
        ...locationFilter,
      },
      include: { location: { select: { name: true } } },
      orderBy: { startDate: 'asc' },
    });

    return rows.map((h) => ({
      id: `holiday-${h.id}`,
      type: 'holiday',
      title: h.name,
      subtitle: h.location?.name ?? 'All locations',
      start: fmt(h.startDate),
      end: fmt(h.endDate),
      allDay: true,
      color,
      link: '/hrm/holidays',
    }));
  }

  /**
   * Leaves in range, for one user — GOURI always resolves a `user_id` (the picked one for an
   * admin, otherwise the caller), so the calendar is never an all-employee leave feed.
   * Same overlap fix as holidays (GOURI filters on `start_date` only).
   */
  private async leaves(
    businessId: number,
    userId: number,
    start: Date,
    end: Date,
  ): Promise<CalendarEvent[]> {
    const color = EVENT_TYPES.find((t) => t.key === 'leaves')!.color;
    const rows = await this.prisma.leave.findMany({
      where: {
        businessId,
        userId,
        startDate: { lte: end },
        endDate: { gte: start },
      },
      include: {
        user: { select: { surname: true, firstName: true, lastName: true } },
        leaveType: { select: { name: true } },
      },
      orderBy: { startDate: 'asc' },
    });

    return rows.map((l) => ({
      id: `leave-${l.id}`,
      type: 'leaves',
      title: fullName(l.user),
      subtitle: `${l.leaveType.name} · ${l.status.toLowerCase() === 'cancelled' ? 'rejected' : l.status.toLowerCase()}`,
      start: fmt(l.startDate),
      end: fmt(l.endDate),
      allDay: true,
      color,
      link: '/hrm/leaves',
    }));
  }

  /** GOURI's `permitted_locations()`: admin / access_all_locations → 'all', else the explicit list. */
  private async permittedLocationIds(businessId: number, userId: number): Promise<'all' | number[]> {
    const dbUser = await this.prisma.user.findFirst({
      where: { id: userId, businessId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        permissions: { include: { permission: true } },
        locations: { select: { locationId: true } },
      },
    });
    if (!dbUser) return [];

    const perms = new Set<string>();
    dbUser.roles.forEach((r) => r.role.permissions.forEach((rp) => perms.add(rp.permission.name)));
    dbUser.permissions.forEach((up) => perms.add(up.permission.name));
    if (perms.has(ACCESS_ALL_LOCATIONS)) return 'all';
    // The tenant Admin bypasses permission checks in code, so match on the role too.
    if (dbUser.roles.some((r) => ['Admin', 'Super Admin'].includes(r.role.name))) return 'all';

    return dbUser.locations.map((l) => l.locationId);
  }
}

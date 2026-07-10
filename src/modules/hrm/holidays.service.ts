import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';

const blank = (v?: string | null): string | null => (v == null || v === '' ? null : v);
const fmt = (d: Date): string => d.toISOString().slice(0, 10);
const daysBetween = (start: Date, end: Date): number =>
  Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;

@Injectable()
export class HolidaysService {
  constructor(private readonly prisma: PrismaService) {}

  async meta(businessId: number) {
    const locations = await this.prisma.businessLocation.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return { locations };
  }

  async findAll(
    businessId: number,
    query: {
      page: number;
      pageSize: number;
      search: string;
      locationId?: number;
      startDate?: string;
      endDate?: string;
    },
  ) {
    const s = query.search.trim();
    const where: Prisma.HolidayWhereInput = {
      businessId,
      deletedAt: null,
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.startDate && query.endDate
        ? { startDate: { lte: new Date(query.endDate) }, endDate: { gte: new Date(query.startDate) } }
        : {}),
      ...(s
        ? {
            OR: [
              { name: { contains: s, mode: 'insensitive' } },
              { note: { contains: s, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.holiday.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { startDate: 'desc' },
        include: { location: true },
      }),
      this.prisma.holiday.count({ where }),
    ]);
    return { data: rows.map((h) => this.shape(h)), total };
  }

  async findOne(businessId: number, id: number) {
    const h = await this.prisma.holiday.findFirst({
      where: { id, businessId, deletedAt: null },
      include: { location: true },
    });
    if (!h) throw new NotFoundException('Holiday not found');
    return this.shape(h);
  }

  async create(businessId: number, userId: number, dto: CreateHolidayDto) {
    await this.assertLocation(businessId, dto.locationId);
    const h = await this.prisma.holiday.create({
      data: {
        businessId,
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        locationId: dto.locationId ?? null,
        note: blank(dto.note),
        createdBy: userId,
      },
      include: { location: true },
    });
    return this.shape(h);
  }

  async update(businessId: number, id: number, dto: UpdateHolidayDto) {
    await this.findOne(businessId, id);
    if (dto.locationId !== undefined && dto.locationId !== null) {
      await this.assertLocation(businessId, dto.locationId);
    }
    const data: Prisma.HolidayUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.locationId !== undefined) data.locationId = dto.locationId;
    if (dto.note !== undefined) data.note = blank(dto.note);
    const h = await this.prisma.holiday.update({ where: { id }, data, include: { location: true } });
    return this.shape(h);
  }

  async remove(businessId: number, id: number) {
    await this.findOne(businessId, id);
    await this.prisma.holiday.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  private shape(h: Prisma.HolidayGetPayload<{ include: { location: true } }>) {
    return {
      id: h.id,
      name: h.name,
      startDate: fmt(h.startDate),
      endDate: fmt(h.endDate),
      days: daysBetween(h.startDate, h.endDate),
      locationId: h.locationId,
      location: h.location?.name ?? null,
      note: h.note ?? '',
    };
  }

  private async assertLocation(businessId: number, locationId?: number | null): Promise<void> {
    if (!locationId) return;
    const loc = await this.prisma.businessLocation.findFirst({
      where: { id: locationId, businessId, deletedAt: null },
    });
    if (!loc) throw new BadRequestException('Selected location is invalid');
  }
}

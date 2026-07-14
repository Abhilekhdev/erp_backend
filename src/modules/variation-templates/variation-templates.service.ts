import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { SaveVariationTemplateDto } from './dto/save-variation-template.dto';

type TemplateRow = Prisma.VariationTemplateGetPayload<{ include: { values: true } }>;

@Injectable()
export class VariationTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(t: TemplateRow) {
    return {
      id: t.id,
      name: t.name,
      values: t.values.map((v) => ({ id: v.id, name: v.name })),
    };
  }

  async findAll(businessId: number) {
    const rows = await this.prisma.variationTemplate.findMany({
      where: { businessId },
      include: { values: { orderBy: { id: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return { data: rows.map((r) => this.shape(r)) };
  }

  /** {id,name,values[]} for the variable-product form's attribute picker. */
  async forDropdown(businessId: number) {
    const rows = await this.prisma.variationTemplate.findMany({
      where: { businessId },
      include: { values: { select: { id: true, name: true }, orderBy: { id: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return {
      data: rows.map((r) => ({ id: r.id, name: r.name, values: r.values.map((v) => v.name) })),
    };
  }

  async findOne(businessId: number, id: number) {
    const row = await this.prisma.variationTemplate.findFirst({
      where: { id, businessId },
      include: { values: { orderBy: { id: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Variation template not found');
    return this.shape(row);
  }

  async create(businessId: number, dto: SaveVariationTemplateDto) {
    const id = await this.prisma.$transaction(async (tx) => {
      const t = await tx.variationTemplate.create({ data: { businessId, name: dto.name, createdAt: new Date() } });
      await tx.variationValueTemplate.createMany({
        data: dto.values.map((name) => ({ variationTemplateId: t.id, name })),
      });
      return t.id;
    });
    return this.findOne(businessId, id);
  }

  async update(businessId: number, id: number, dto: SaveVariationTemplateDto) {
    await this.findOne(businessId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.variationTemplate.update({ where: { id }, data: { name: dto.name } });
      await tx.variationValueTemplate.deleteMany({ where: { variationTemplateId: id } });
      await tx.variationValueTemplate.createMany({
        data: dto.values.map((name) => ({ variationTemplateId: id, name })),
      });
    });
    return this.findOne(businessId, id);
  }

  async remove(businessId: number, id: number) {
    await this.findOne(businessId, id);
    // NOTE: GOURI blocks deletion when a product uses this template (product_variations) — add once Products exists.
    await this.prisma.variationTemplate.delete({ where: { id } }); // values cascade
    return { success: true, msg: 'Variation template deleted successfully' };
  }
}

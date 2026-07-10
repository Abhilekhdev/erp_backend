import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OrgListService, type OrgDelegate } from './org-list.service';

@Injectable()
export class DepartmentsService extends OrgListService {
  constructor(private readonly prisma: PrismaService) {
    super();
  }
  protected get delegate(): OrgDelegate {
    return this.prisma.department as unknown as OrgDelegate;
  }
  protected get label(): string {
    return 'Department';
  }
}

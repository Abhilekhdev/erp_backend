import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OrgListService, type OrgDelegate } from './org-list.service';

@Injectable()
export class DesignationsService extends OrgListService {
  constructor(private readonly prisma: PrismaService) {
    super();
  }
  protected get delegate(): OrgDelegate {
    return this.prisma.designation as unknown as OrgDelegate;
  }
  protected get label(): string {
    return 'Designation';
  }
}

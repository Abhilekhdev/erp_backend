import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.query';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { AccessPayload } from '../auth/token.service';
import { BusinessLocationsService } from './business-locations.service';
import { SaveBusinessLocationDto } from './dto/save-business-location.dto';

@Controller('business/locations')
@UseGuards(PermissionsGuard)
export class BusinessLocationsController {
  constructor(private readonly locations: BusinessLocationsService) {}

  @Get()
  @RequirePermissions('business_settings.access')
  findAll(@CurrentUser() user: AccessPayload, @Query() query: PaginationQueryDto) {
    return this.locations.findAll(user, query);
  }

  @Get('options')
  @RequirePermissions('business_settings.access')
  getOptions(@CurrentUser() user: AccessPayload) {
    return this.locations.getOptions(user.businessId as number);
  }

  @Get('check-location-id')
  @RequirePermissions('business_settings.access')
  checkLocationId(
    @CurrentUser() user: AccessPayload,
    @Query('location_id') locationId?: string,
    @Query('hidden_id') hiddenId?: string,
  ) {
    return this.locations.checkLocationId(
      user.businessId as number,
      locationId,
      hiddenId ? Number(hiddenId) : undefined,
    );
  }

  @Get(':id')
  @RequirePermissions('business_settings.access')
  findOne(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.locations.findOne(user.businessId as number, id);
  }

  @Post()
  @RequirePermissions('business_settings.access')
  create(@CurrentUser() user: AccessPayload, @Body() dto: SaveBusinessLocationDto) {
    return this.locations.create(user.businessId as number, dto);
  }

  @Patch(':id')
  @RequirePermissions('business_settings.access')
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveBusinessLocationDto,
  ) {
    return this.locations.update(user.businessId as number, id, dto);
  }

  @Post(':id/activate-deactivate')
  @RequirePermissions('business_settings.access')
  @HttpCode(200)
  activateDeactivate(@CurrentUser() user: AccessPayload, @Param('id', ParseIntPipe) id: number) {
    return this.locations.activateDeactivate(user.businessId as number, id);
  }
}

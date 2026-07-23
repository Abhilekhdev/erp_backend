import { Module } from '@nestjs/common';
import { ActivityCodesController } from './activity-codes.controller';
import { ActivityCodesService } from './activity-codes.service';
import { AllowanceDeductionsController } from './allowance-deductions.controller';
import { AllowanceDeductionsService } from './allowance-deductions.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { ClaimCategoriesController } from './claim-categories.controller';
import { ClaimCategoriesService } from './claim-categories.service';
import { ClaimsController } from './claims.controller';
import { ClaimsService } from './claims.service';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { DesignationsController } from './designations.controller';
import { DesignationsService } from './designations.service';
import { HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';
import { HrmDashboardController } from './hrm-dashboard.controller';
import { HrmDashboardService } from './hrm-dashboard.service';
import { HrmSettingsController } from './hrm-settings.controller';
import { HrmSettingsService } from './hrm-settings.service';
import { LeaveTypesController } from './leave-types.controller';
import { LeaveTypesService } from './leave-types.service';
import { LeavesController } from './leaves.controller';
import { LeavesService } from './leaves.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayslipPdfService } from './payslip-pdf.service';
import { SalesTargetsController } from './sales-targets.controller';
import { SalesTargetsService } from './sales-targets.service';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  controllers: [
    HrmDashboardController,
    DepartmentsController,
    DesignationsController,
    LeaveTypesController,
    LeavesController,
    HolidaysController,
    ActivityCodesController,
    ShiftsController,
    AttendanceController,
    SalesTargetsController,
    HrmSettingsController,
    AllowanceDeductionsController,
    PayrollController,
    ClaimsController,
    ClaimCategoriesController,
  ],
  providers: [
    HrmDashboardService,
    DepartmentsService,
    DesignationsService,
    LeaveTypesService,
    LeavesService,
    HolidaysService,
    ActivityCodesService,
    ShiftsService,
    AttendanceService,
    SalesTargetsService,
    HrmSettingsService,
    AllowanceDeductionsService,
    PayrollService,
    PayslipPdfService,
    ClaimsService,
    ClaimCategoriesService,
  ],
  exports: [DepartmentsService, DesignationsService, LeaveTypesService, LeavesService],
})
export class HrmModule {}

import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ContactsImportService } from './import/contacts-import.service';

@Module({
  controllers: [ContactsController],
  providers: [ContactsService, ContactsImportService],
  exports: [ContactsService],
})
export class ContactsModule {}

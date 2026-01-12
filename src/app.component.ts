import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DataService } from './services/data.service';
import { SupabaseService } from './services/supabase.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet]
})
export class AppComponent implements OnInit {
  private dataService = inject(DataService);
  private supabaseService = inject(SupabaseService);
  
  loadingStatus = this.dataService.loadingStatus;
  initializationError = this.supabaseService.initializationError;

  ngOnInit() {
    this.dataService.load();
  }
}
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DataService } from './services/data.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet]
})
export class AppComponent implements OnInit {
  private dataService = inject(DataService);
  
  loadingStatus = this.dataService.loadingStatus;
  loadingError = this.dataService.loadingError;

  ngOnInit() {
    this.dataService.load();
  }
}
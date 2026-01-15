import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DataService } from './services/data.service';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet]
})
export class AppComponent implements OnInit {
  private dataService = inject(DataService);
  private authService = inject(AuthService);
  
  loadingStatus = this.dataService.loadingStatus;
  loadingError = this.dataService.loadingError;

  ngOnInit() {
    // Primeiro, inicializa o estado de autenticação a partir do armazenamento local.
    this.authService.init();
    // Em seguida, carrega todos os dados da aplicação.
    this.dataService.load();
  }
}
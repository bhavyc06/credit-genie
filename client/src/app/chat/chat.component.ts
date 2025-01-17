import { HttpClient, HttpClientModule } from '@angular/common/http';
import { Component, OnInit, ViewChildren } from '@angular/core';
import { FormGroup, FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common'; // (1) Import CommonModule here
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MarkdownComponent, MarkdownPipe } from 'ngx-markdown';

import { config } from '../../config';

interface Message {
  text: string;
  type: 'human' | 'bot' | 'loading';
}

@Component({
  selector: 'app-chat',
  standalone: true,
  // (2) Add CommonModule to the imports array so *ngIf, *ngFor, *ngSwitchCase are recognized
  imports: [
    CommonModule,
    ReactiveFormsModule,
    HttpClientModule,
    MatInputModule,
    MatButtonModule,
    MatCheckboxModule,
    MatButtonToggleModule,
    MarkdownComponent,
    MarkdownPipe,
  ],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
})
export class ChatComponent implements OnInit {
  loginForm: FormGroup;
  authToken: string | null = null;

  messageForm: FormGroup;
  messages: Message[] = [];
  scrolled = false;

  @ViewChildren('message') messageElements: any;

  constructor(
    private fb: FormBuilder,
    private httpClient: HttpClient
  ) {
    this.authToken = null;
    console.log("Auth token in constructor:", this.authToken);

  }

  ngOnInit(): void {
    console.log("Auth token at ngOnInit:", this.authToken);

    this.loginForm = this.fb.group({
      username: [''],
      password: [''],
    });

    this.messageForm = this.fb.group({
      text: [''],
      rag: [false],
    });
  }

  ngAfterViewChecked(): void {
    if (!this.scrolled) {
      const element = this.messageElements?.last?.nativeElement;
      element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      this.scrolled = true;
    } else {
      this.scrolled = false;
    }
  }

  loggedIn = false; // NEW property


  login(): void {
    const { username, password } = this.loginForm.value;
    this.httpClient
      .post(`${config.backendUrl}/login`, { username, password })
      .subscribe({
        next: (data: any) => {
          console.log('Full data response:', data);

          this.authToken = data.token;
          console.log('Got token:', this.authToken);
  
          // ADD THIS LINE:
          console.log('loggedIn before check:', this.loggedIn);

          if (this.authToken) {
            this.loggedIn = true;
            console.log('loggedIn is now:', this.loggedIn);

          }
  
          this.loginForm.reset();
        },
        error: (err) => {
          console.error('Login error:', err);
        },
      });
  }
  
  submitForm(): void {
    const { text, rag } = this.messageForm.value;

    this.messages.push({
      text,
      type: 'human',
    });

    setTimeout(() => {
      this.messages.push({
        text: '',
        type: 'loading',
      });

      const headers: Record<string, string> = {
        'bypass-tunnel-reminder': 'true',
        'ngrok-skip-browser-warning': 'true',
      };
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      this.httpClient
        .post(`${config.backendUrl}/messages`, { text, rag }, { headers })
        .subscribe({
          next: (response: any) => {
            this.messages.pop();
            this.messages.push({
              text: response.text,
              type: 'bot',
            });
          },
          error: (error: any) => {
            console.error(error);
            this.messages.pop();
            this.messages.push({
              text: "Sorry, I'm having trouble understanding you right now. Please try again later.",
              type: 'bot',
            });
          },
        });

      this.messageForm.reset();
      this.messageForm.patchValue({ rag });
    }, 300);
  }
}

import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export type ProgressState = 'running' | 'done' | 'failed';

export interface StageSummary {
  readonly stepId: string;
  readonly message: string;
}

export interface ProgressEvent {
  readonly model: string;
  readonly stepId: string;
  readonly message: string;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly expectedSeconds: number;
  readonly elapsedInStepMs: number;
  readonly state: ProgressState;
  readonly stages: readonly StageSummary[];
}

export interface ProgressJob {
  readonly stepIds: readonly string[];
  readonly messages: Map<string, string>;
  stepId: string;
  message: string;
  stepStartedAt: number;
  state: ProgressState;
}

@Injectable()
export class ProgressService {
  private readonly jobs = new Map<string, ProgressJob>();
  private readonly subjects = new Map<string, Subject<ProgressEvent>>();

  public begin(model: string, stepIds: readonly string[]): void {
    const job: ProgressJob = {
      stepIds,
      messages: new Map<string, string>(),
      stepId: stepIds[0] || 's1-step-1',
      message: 'Starting generation...',
      stepStartedAt: Date.now(),
      state: 'running',
    };
    this.jobs.set(model, job);
    this.broadcast(model);
  }

  public report(model: string, stepId: string, message: string): void {
    const job = this.jobs.get(model);
    if (!job) return;

    if (job.stepId !== stepId) {
      job.stepId = stepId;
      job.stepStartedAt = Date.now();
    }
    job.message = message;
    job.messages.set(stepId, message);
    this.broadcast(model);
  }

  public finish(model: string, message = 'Completed'): void {
    const job = this.jobs.get(model);
    if (!job) return;
    job.message = message;
    job.state = 'done';
    this.broadcast(model);
  }

  public fail(model: string, message: string): void {
    const job = this.jobs.get(model);
    if (!job) return;
    job.message = message;
    job.state = 'failed';
    this.broadcast(model);
  }

  public getStream(model: string): Observable<ProgressEvent> {
    let subject = this.subjects.get(model);
    if (!subject) {
      subject = new Subject<ProgressEvent>();
      this.subjects.set(model, subject);
    }

    return new Observable<ProgressEvent>((subscriber) => {
      // Emit current status immediately if job exists
      const current = this.getCurrentEvent(model);
      if (current) {
        subscriber.next(current);
      }

      const subscription = subject!.subscribe(subscriber);
      return () => subscription.unsubscribe();
    });
  }

  public getCurrentEvent(model: string): ProgressEvent | null {
    const job = this.jobs.get(model);
    if (!job) return null;
    return this.toEvent(model, job);
  }

  private broadcast(model: string): void {
    const subject = this.subjects.get(model);
    const event = this.getCurrentEvent(model);
    if (subject && event) {
      subject.next(event);
    }
  }

  private toEvent(model: string, job: ProgressJob): ProgressEvent {
    const stepIndex = Math.max(0, job.stepIds.indexOf(job.stepId));
    const stages: StageSummary[] = [];
    for (const [stepId, message] of job.messages.entries()) {
      stages.push({ stepId, message });
    }

    return {
      model,
      stepId: job.stepId,
      message: job.message,
      stepIndex: stepIndex + 1,
      stepCount: job.stepIds.length,
      expectedSeconds: 20,
      elapsedInStepMs: Math.max(0, Date.now() - job.stepStartedAt),
      state: job.state,
      stages,
    };
  }
}

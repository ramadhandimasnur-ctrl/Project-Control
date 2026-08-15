'use client';

import { createProjectAction } from '@/features/projects/actions';
import { ProjectForm } from '@/features/projects/project-form';
import { PROJECT_FORM_DEFAULTS } from '@/lib/validation/project';

export function NewProjectForm() {
  return (
    <ProjectForm
      defaultValues={PROJECT_FORM_DEFAULTS}
      submitLabel="Buat proyek"
      canEditContractTerms
      onSubmitAction={createProjectAction}
    />
  );
}

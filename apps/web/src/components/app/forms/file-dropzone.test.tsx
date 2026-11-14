import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileDropzone, type FileDropzoneProps } from './file-dropzone';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const props = (overrides: Partial<FileDropzoneProps> = {}): FileDropzoneProps => ({
  accept: '.csv,text/csv',
  constraints: 'CSV, UTF-8, up to 50 MB.',
  file: null,
  onFile: vi.fn(),
  onRemove: vi.fn(),
  error: null,
  progress: null,
  progressText: null,
  disabled: false,
  ...overrides,
});

describe('FileDropzone', () => {
  it('asks for a file with the drop instruction and a Choose file button, and says the rules of the file', async () => {
    const { container } = renderWithProviders(<FileDropzone {...props()} />);
    expect(screen.getByText('Drop a CSV file here, or choose one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeEnabled();
    expect(screen.getByText('CSV, UTF-8, up to 50 MB.')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('changes the instruction while a file is dragged over the box', () => {
    renderWithProviders(<FileDropzone {...props()} />);
    const box = screen.getByText('Drop a CSV file here, or choose one').closest('[data-slot="file-dropzone"]');
    expect(box).not.toBeNull();
    if (box === null) return;
    fireEvent.dragEnter(box);
    expect(screen.getByText('Drop to upload')).toBeInTheDocument();
  });

  it('hands the chosen file to onFile', async () => {
    const onFile = vi.fn();
    const { container, user } = renderWithProviders(<FileDropzone {...props({ onFile })} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    const file = new File(['keyword'], 'keywords.csv', { type: 'text/csv' });
    await user.upload(input, file);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('shows a chosen file as one row with its name and size, and Remove calls onRemove', async () => {
    const onRemove = vi.fn();
    const { user } = renderWithProviders(
      <FileDropzone {...props({ file: { name: 'keywords.csv', sizeText: '12 KB' }, onRemove })} />,
    );
    expect(screen.getByText('keywords.csv, 12 KB')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose file' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove file' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('names the upload in its progress bar', () => {
    renderWithProviders(
      <FileDropzone
        {...props({ file: { name: 'keywords.csv', sizeText: '12 KB' }, progress: 42, progressText: '42% uploaded' })}
      />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Uploading keywords.csv' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuetext', '42% uploaded');
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertGoogleDocUrl,
  assertQuestionnaireFile,
  buildUploadFormData,
} from './file-upload.js';

test('builds upload form data for supported files', () => {
  const formData = buildUploadFormData([
    {
      file_name: 'brief.pdf',
      mime_type: 'application/pdf',
      content_base64: Buffer.from('pdf').toString('base64'),
    },
  ]);

  assert.ok(formData instanceof FormData);
});

test('rejects plain text uploads', () => {
  assert.throws(
    () =>
      buildUploadFormData([
        {
          file_name: 'notes.txt',
          mime_type: 'text/plain' as never,
          content_base64: Buffer.from('notes').toString('base64'),
        },
      ]),
    /Unsupported file extension/
  );
});

test('accepts only document files for campaign questionnaires', () => {
  assert.doesNotThrow(() => assertQuestionnaireFile('questionnaire.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));

  assert.throws(
    () => assertQuestionnaireFile('questionnaire.txt', 'text/plain'),
    /Questionnaire uploads only support PDF, DOC, and DOCX/
  );
});

test('accepts only HTTPS Google Docs URLs for article uploads', () => {
  assert.doesNotThrow(() => assertGoogleDocUrl('https://docs.google.com/document/d/example/edit'));

  assert.throws(
    () => assertGoogleDocUrl('https://example.com/document/d/example/edit'),
    /must be an HTTPS Google Docs URL/
  );
});

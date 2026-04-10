function initAddCoursePage() {
  if (window.__skillboostAddCourseInitialized) {
    return;
  }
  window.__skillboostAddCourseInitialized = true;

  const createForm = document.getElementById('createCourseForm');
  const uploadForm = document.getElementById('uploadVideoForm');
  const courseSelect = document.getElementById('courseSelect');
  const coverInput = document.getElementById('cover');
  const coverEditHint = document.getElementById('coverEditHint');
  const submitBtn = document.getElementById('courseSubmitBtn');
  const uploadSubmitBtn = document.getElementById('uploadVideoBtn') || uploadForm?.querySelector('button');
  const uploadSubmitBtnDefaultLabel = uploadSubmitBtn?.textContent?.trim() || 'Upload Video';
  const courseStatusEl = document.getElementById('courseFormStatus');
  const uploadStatusEl = document.getElementById('uploadVideoStatus');
  const uploadProgressEl = document.getElementById('uploadVideoProgress');
  const uploadProgressLabelEl = document.getElementById('uploadVideoProgressLabel');
  const uploadProgressPercentEl = document.getElementById('uploadVideoProgressPercent');
  const uploadProgressFillEl = document.getElementById('uploadVideoProgressFill');
  const uploadProgressBarEl = uploadProgressEl?.querySelector('.upload-progress-bar');
  const manageCourseTitle = document.getElementById('manageCourseTitle');
  const durationInputs = Array.from(document.querySelectorAll('input[name="duration_days"]'));
  let editingCourseId = null;
  let pendingCourseId = null;
  let isVideoUploadInProgress = false;
  const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;
  const UPLOAD_STATE_STORAGE_KEY = 'skillboost:video-upload-state';
  const UPLOAD_STATE_MAX_AGE_MS = 10 * 60 * 1000;
  const API_BASE = window.SkillBoostApp?.apiBase || window.location.origin;
  const buildApiUrl = window.SkillBoostApp?.buildApiUrl
    || ((path = '') => `${API_BASE}${String(path || '').startsWith('/') ? path : `/${path}`}`);
  const showPageToast = (message, tone = 'info', durationMs = 3200) => {
    window.SkillBoostPageToast?.show?.(message, tone, durationMs);
  };

  const instructorId = localStorage.getItem('instructorId');
  if (!instructorId) {
    showPageToast('Please log in as an instructor to manage courses.', 'warning', 2200);
    window.location.href = 'login.html?role=instructor';
    return;
  }

  const instructorField = document.getElementById('instructor_id');
  if (instructorField) {
    instructorField.value = instructorId;
  }

  const videoInstructorField = document.getElementById('video_instructor_id');
  if (videoInstructorField) {
    videoInstructorField.value = instructorId;
  }

  if (uploadForm) {
    uploadForm.noValidate = true;
    uploadForm.setAttribute('novalidate', 'novalidate');
  }

  if (uploadSubmitBtn) {
    uploadSubmitBtn.type = 'button';
  }

  function setFormStatus(target, type, message) {
    if (!target) {
      return;
    }

    target.hidden = !message;
    target.textContent = message || '';
    target.classList.remove('is-info', 'is-success', 'is-error');
    if (message && type) {
      target.classList.add(`is-${type}`);
    }
  }

  function resetUploadProgress() {
    if (!uploadProgressEl) {
      return;
    }

    uploadProgressEl.hidden = true;
    uploadProgressEl.classList.remove('is-complete');

    if (uploadProgressLabelEl) {
      uploadProgressLabelEl.textContent = 'Preparing upload...';
    }

    if (uploadProgressPercentEl) {
      uploadProgressPercentEl.textContent = '0%';
    }

    if (uploadProgressFillEl) {
      uploadProgressFillEl.style.width = '0%';
    }

    if (uploadProgressBarEl) {
      uploadProgressBarEl.setAttribute('aria-valuenow', '0');
    }
  }

  function setUploadProgress(percent, label, options = {}) {
    if (!uploadProgressEl) {
      return;
    }

    const normalizedPercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    const isComplete = Boolean(options.complete) || normalizedPercent >= 100;

    uploadProgressEl.hidden = false;
    uploadProgressEl.classList.toggle('is-complete', isComplete);

    if (uploadProgressLabelEl && label) {
      uploadProgressLabelEl.textContent = label;
    }

    if (uploadProgressPercentEl) {
      uploadProgressPercentEl.textContent = `${normalizedPercent}%`;
    }

    if (uploadProgressFillEl) {
      uploadProgressFillEl.style.width = `${normalizedPercent}%`;
    }

    if (uploadProgressBarEl) {
      uploadProgressBarEl.setAttribute('aria-valuenow', String(normalizedPercent));
    }
  }

  function getUploadProgressPercent() {
    const numericPercent = Number.parseInt(String(uploadProgressPercentEl?.textContent || '0').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(numericPercent) ? numericPercent : 0;
  }

  function scrollUploadFeedbackIntoView() {
    const target = uploadStatusEl || uploadProgressEl;
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function rememberUploadState(overrides = {}) {
    if (!uploadForm) {
      return;
    }

    const lessonTitleInput = document.getElementById('lessonTitle');
    const rawPercent = overrides.percent ?? getUploadProgressPercent();
    const normalizedPercent = Math.max(0, Math.min(100, Math.round(Number(rawPercent) || 0)));
    const payload = {
      type: overrides.type ?? '',
      message: overrides.message ?? String(uploadStatusEl?.textContent || '').trim(),
      percent: normalizedPercent,
      label: overrides.label ?? String(uploadProgressLabelEl?.textContent || '').trim(),
      complete: Boolean(overrides.complete),
      inProgress: Boolean(overrides.inProgress),
      selectedCourse: String(overrides.selectedCourse ?? courseSelect?.value ?? ''),
      lessonTitle: overrides.lessonTitle ?? lessonTitleInput?.value?.trim?.() ?? '',
      updatedAt: Date.now()
    };

    try {
      window.sessionStorage.setItem(UPLOAD_STATE_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Unable to persist upload UI state:', error);
    }
  }

  function clearUploadState() {
    try {
      window.sessionStorage.removeItem(UPLOAD_STATE_STORAGE_KEY);
    } catch (error) {
      console.warn('Unable to clear upload UI state:', error);
    }
  }

  function restoreUploadState() {
    if (!uploadForm) {
      return;
    }

    let storedState = null;

    try {
      const serializedState = window.sessionStorage.getItem(UPLOAD_STATE_STORAGE_KEY);
      storedState = serializedState ? JSON.parse(serializedState) : null;
    } catch (error) {
      console.warn('Unable to restore upload UI state:', error);
      clearUploadState();
      return;
    }

    if (!storedState) {
      return;
    }

    if (Date.now() - Number(storedState.updatedAt || 0) > UPLOAD_STATE_MAX_AGE_MS) {
      clearUploadState();
      return;
    }

    if (storedState.selectedCourse) {
      pendingCourseId = String(storedState.selectedCourse);
      applyPendingSelection();
    }

    const lessonTitleInput = document.getElementById('lessonTitle');
    if (lessonTitleInput && storedState.lessonTitle && !lessonTitleInput.value) {
      lessonTitleInput.value = storedState.lessonTitle;
    }

    const wasInterrupted = Boolean(storedState.inProgress);
    const restoredPercent = Math.max(0, Math.min(100, Math.round(Number(storedState.percent) || 0)));
    const restoredLabel = wasInterrupted
      ? 'Upload interrupted'
      : (storedState.label || 'Preparing upload...');
    const restoredMessage = wasInterrupted
      ? 'The page refreshed before the upload finished, so the lesson was not uploaded. Please try again.'
      : storedState.message;

    if (restoredLabel || restoredPercent > 0 || wasInterrupted || storedState.complete) {
      setUploadProgress(
        wasInterrupted ? Math.min(restoredPercent, 97) : restoredPercent,
        restoredLabel,
        { complete: Boolean(storedState.complete) && !wasInterrupted }
      );
    }

    if (restoredMessage) {
      setFormStatus(uploadStatusEl, wasInterrupted ? 'error' : (storedState.type || 'info'), restoredMessage);
    }

    if (wasInterrupted) {
      rememberUploadState({
        type: 'error',
        message: restoredMessage,
        percent: Math.min(restoredPercent, 97),
        label: restoredLabel,
        complete: false,
        inProgress: false,
        selectedCourse: storedState.selectedCourse,
        lessonTitle: storedState.lessonTitle
      });
      scrollUploadFeedbackIntoView();
    }
  }

  function handleUploadBeforeUnload(event) {
    if (!isVideoUploadInProgress) {
      return;
    }

    rememberUploadState({ inProgress: true });
    event.preventDefault();
    event.returnValue = 'A lesson upload is still in progress.';
  }

  function applyPendingSelection() {
    if (!courseSelect || !pendingCourseId) return;
    const option = Array.from(courseSelect.options).find((item) => item.value === String(pendingCourseId));
    if (option) {
      courseSelect.value = String(pendingCourseId);
      if (manageCourseTitle) {
        manageCourseTitle.textContent = option.textContent || 'Selected course';
      }
      pendingCourseId = null;
    }
  }

  function setEditMode(course) {
    if (!createForm || !course) return;
    editingCourseId = course.id;
    if (coverInput) {
      coverInput.required = false;
    }
    if (coverEditHint) {
      coverEditHint.hidden = false;
    }
    if (submitBtn) {
      submitBtn.textContent = 'Update Course';
    }
    const title = document.getElementById('title');
    const category = document.getElementById('category');
    const description = document.getElementById('description');
    if (title) title.value = course.title || '';
    if (durationInputs.length > 0) {
      const matchedDuration = durationInputs.find((input) => Number(input.value) === Number(course.duration_days || 90));
      if (matchedDuration) {
        matchedDuration.checked = true;
      }
    }
    if (category) category.value = course.category || '';
    if (description) description.value = course.description || '';
  }

  function clearEditMode() {
    editingCourseId = null;
    if (coverInput) {
      coverInput.required = true;
    }
    if (coverEditHint) {
      coverEditHint.hidden = true;
    }
    if (submitBtn) {
      submitBtn.textContent = 'Create Course';
    }
    if (durationInputs.length > 0) {
      const defaultDuration = durationInputs.find((input) => Number(input.value) === 90) || durationInputs[0];
      if (defaultDuration) {
        defaultDuration.checked = true;
      }
    }
  }

  window.clearInstructorCourseEditor = clearEditMode;
  clearEditMode();

  if (courseSelect && manageCourseTitle) {
    courseSelect.addEventListener('change', () => {
      const selected = courseSelect.options[courseSelect.selectedIndex];
      manageCourseTitle.textContent = selected && selected.value ? selected.textContent : 'Select a course';
    });
  }

  window.setInstructorCourseSelection = (courseId) => {
    pendingCourseId = String(courseId);
    applyPendingSelection();
  };

  window.openCourseEditor = (course) => {
    setEditMode(course);
  };

  restoreUploadState();

  if (uploadForm) {
    window.addEventListener('beforeunload', handleUploadBeforeUnload);
  }

  async function readApiPayload(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    const text = await response.text();
    return {
      error: text || 'Unexpected response from server',
      details: text || ''
    };
  }

  function buildFailureReason(response, payload, fallbackMessage) {
    const errorText = String(payload?.error || '').trim();
    const detailText = String(payload?.details || payload?.message || '').trim();
    const combinedMessage = errorText && detailText && detailText !== errorText
      ? `${errorText}: ${detailText}`
      : (errorText || detailText || fallbackMessage);

    if (response.status === 413) {
      return 'Upload failed: file size exceeds the 100MB limit.';
    }

    if (response.status === 503) {
      return `${combinedMessage}. Please restart the backend and verify your Cloudinary values in backend/.env.`;
    }

    if (response.status === 404) {
      return combinedMessage || 'The selected course was not found.';
    }

    if (response.status === 403) {
      return combinedMessage || 'You do not have permission to do this action.';
    }

    if (response.status === 400) {
      return combinedMessage || fallbackMessage;
    }

    if (response.status >= 500) {
      return combinedMessage || `${fallbackMessage}. Please check the backend console for the exact error.`;
    }

    return combinedMessage || fallbackMessage;
  }

  function buildNetworkFailureReason(actionLabel) {
    return `Unable to ${actionLabel} because the backend server could not be reached. Please make sure the backend server is available.`;
  }

  async function verifyUploadedVideo(courseId, uploadedVideoId) {
    if (!courseId) {
      return { verified: false, totalVideos: 0 };
    }

    const response = await fetch(buildApiUrl(`/api/course-videos/${courseId}`));
    const data = await readApiPayload(response);

    if (!response.ok) {
      throw new Error(buildFailureReason(response, data, 'Could not verify the uploaded lesson.'));
    }

    const videos = Array.isArray(data?.videos) ? data.videos : [];
    const verified = uploadedVideoId
      ? videos.some((video) => String(video.id) === String(uploadedVideoId))
      : videos.length > 0;

    return {
      verified,
      totalVideos: videos.length
    };
  }

  function parseXhrPayload(xhr) {
    const responseText = xhr?.responseText || '';

    if (!responseText) {
      return {};
    }

    try {
      return JSON.parse(responseText);
    } catch (error) {
      return {
        error: responseText || 'Unexpected response from server',
        details: responseText || ''
      };
    }
  }

  async function loadInstructorCourses() {
    if (!courseSelect) return;
    courseSelect.innerHTML = '<option value="">Loading courses...</option>';
    try {
      const response = await fetch(buildApiUrl(`/api/courses/${instructorId}`));
      const data = await readApiPayload(response);
      const courses = Array.isArray(data) ? data : [];
      if (courses.length === 0) {
        courseSelect.innerHTML = '<option value="">No courses found</option>';
        return;
      }
      courseSelect.innerHTML = '<option value="">Choose a course</option>';
      courses.forEach((course) => {
        const option = document.createElement('option');
        option.value = course.id;
        option.textContent = course.title;
        courseSelect.appendChild(option);
      });
      applyPendingSelection();
    } catch (error) {
      console.error('Failed to load courses', error);
      courseSelect.innerHTML = '<option value="">Failed to load courses</option>';
      const message = buildNetworkFailureReason('load your courses');
      setFormStatus(uploadStatusEl, 'error', message);
      showPageToast(message, 'error', 4200);
    }
  }

  loadInstructorCourses();

  if (createForm) {
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const isEditing = Boolean(editingCourseId);
      const actionLabel = isEditing ? 'update' : 'creation';

      try {
        setFormStatus(courseStatusEl, 'info', isEditing ? 'Updating course...' : 'Creating course...');
        const title = document.getElementById('title')?.value.trim() || '';
        const durationInputs = Array.from(document.querySelectorAll('input[name="duration_days"]'));
        const selectedDuration = durationInputs.find((input) => input.checked);
        const cover = document.getElementById('cover').files[0];
        const category = document.getElementById('category')?.value.trim() || '';
        const description = document.getElementById('description')?.value.trim() || '';

        console.log('Form validation:', { title, selectedDuration, cover, category, description, durationInputs: durationInputs.length });

        if (!title) {
          setFormStatus(courseStatusEl, 'error', 'Please enter a course title.');
          showPageToast('Please enter a course title.', 'warning', 3200);
          return;
        }
        if (!selectedDuration) {
          setFormStatus(courseStatusEl, 'error', 'Please select a course duration.');
          showPageToast('Please select a course duration.', 'warning', 3200);
          return;
        }
        if (!category) {
          setFormStatus(courseStatusEl, 'error', 'Please enter a category.');
          showPageToast('Please enter a category.', 'warning', 3200);
          return;
        }
        if (!description) {
          setFormStatus(courseStatusEl, 'error', 'Please enter a course description.');
          showPageToast('Please enter a course description.', 'warning', 3200);
          return;
        }

        if (!isEditing && !cover) {
          setFormStatus(courseStatusEl, 'error', 'Please select a cover image.');
          showPageToast('Please select a cover image.', 'warning', 3200);
          return;
        }

        const allowedImageTypes = ['image/jpeg', 'image/png', 'image/jpg'];
        if (cover && !allowedImageTypes.includes(cover.type)) {
          setFormStatus(courseStatusEl, 'error', 'Please upload a valid image file (jpg, jpeg, png).');
          showPageToast('Please upload a valid image file (jpg, jpeg, png).', 'warning', 3600);
          return;
        }

        const formData = new FormData(createForm);
        formData.set('instructor_id', instructorId);
        formData.set('description', description);
        formData.set('duration_days', selectedDuration.value);

        const response = isEditing
          ? await fetch(buildApiUrl(`/api/courses/${editingCourseId}`), {
              method: 'PUT',
              body: formData
            })
          : await fetch(buildApiUrl('/courses'), {
              method: 'POST',
              body: formData
            });

        const data = await readApiPayload(response);

        if (!response.ok) {
          const failureMessage = buildFailureReason(
            response,
            data,
            `Course ${actionLabel} failed. Please try again.`
          );
          setFormStatus(courseStatusEl, 'error', failureMessage);
          showPageToast(failureMessage, 'error', 4200);
          return;
        }

        if (isEditing) {
          setFormStatus(courseStatusEl, 'success', 'Course updated successfully.');
          showPageToast('Course updated successfully.', 'success', 2800);
          clearEditMode();
        } else {
          pendingCourseId = data.courseId ? String(data.courseId) : pendingCourseId;
          setFormStatus(courseStatusEl, 'success', 'Course created successfully. You can upload lesson videos now.');
          showPageToast('Course created successfully. Now upload lesson videos.', 'success', 3200);
        }
        createForm.reset();
        clearEditMode();
        loadInstructorCourses();
        window.dispatchEvent(new CustomEvent('instructor:courseChanged'));
      } catch (error) {
        console.error('Course create error:', error);
        const message = buildNetworkFailureReason(isEditing ? 'update the course' : 'create the course');
        setFormStatus(courseStatusEl, 'error', message);
        showPageToast(message, 'error', 4200);
      }
    });
  }

  async function handleVideoUpload(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!uploadForm || isVideoUploadInProgress) {
      return;
    }

    try {
      isVideoUploadInProgress = true;
      const selectedCourse = courseSelect?.value;
      const lessonTitleInput = document.getElementById('lessonTitle');
      const lessonVideoInput = document.getElementById('lessonVideo');
      const lessonTitle = lessonTitleInput?.value.trim() || '';
      const lessonVideo = lessonVideoInput?.files?.[0];

      // Validation with proper error display (no resetUploadProgress!)
      if (!selectedCourse) {
        setFormStatus(uploadStatusEl, 'error', 'Please select a course.');
        showPageToast('Please select a course before uploading a video.', 'warning', 3200);
        rememberUploadState({
          type: 'error',
          message: 'Please select a course.',
          percent: 0,
          label: 'Upload not started',
          complete: false,
          inProgress: false,
          selectedCourse,
          lessonTitle
        });
        scrollUploadFeedbackIntoView();
        return;
      }

      if (!lessonVideo) {
        setFormStatus(uploadStatusEl, 'error', 'Please select a video file to upload.');
        showPageToast('Please select a video file to upload.', 'warning', 3200);
        rememberUploadState({
          type: 'error',
          message: 'Please select a video file to upload.',
          percent: 0,
          label: 'Upload not started',
          complete: false,
          inProgress: false,
          selectedCourse,
          lessonTitle
        });
        scrollUploadFeedbackIntoView();
        return;
      }

      if (lessonVideo.type && !lessonVideo.type.startsWith('video/')) {
        setFormStatus(uploadStatusEl, 'error', `Please upload a valid video file. Selected type: ${lessonVideo.type}`);
        showPageToast(`Please upload a valid video file. Selected type: ${lessonVideo.type}`, 'warning', 3800);
        rememberUploadState({
          type: 'error',
          message: `Please upload a valid video file. Selected type: ${lessonVideo.type}`,
          percent: 0,
          label: 'Upload not started',
          complete: false,
          inProgress: false,
          selectedCourse,
          lessonTitle
        });
        scrollUploadFeedbackIntoView();
        return;
      }

      if (lessonVideo.size > MAX_VIDEO_SIZE_BYTES) {
        setFormStatus(uploadStatusEl, 'error', 'Video upload failed: file size exceeds the 100MB limit.');
        showPageToast('Video upload failed: file size exceeds the 100MB limit.', 'error', 4200);
        rememberUploadState({
          type: 'error',
          message: 'Video upload failed: file size exceeds the 100MB limit.',
          percent: 0,
          label: 'Upload not started',
          complete: false,
          inProgress: false,
          selectedCourse,
          lessonTitle
        });
        scrollUploadFeedbackIntoView();
        return;
      }

      // Show progress UI and clear previous errors
      resetUploadProgress();
      setFormStatus(uploadStatusEl, 'info', 'Preparing upload... 0% complete');
      setUploadProgress(0, 'Preparing upload...');
      rememberUploadState({
        type: 'info',
        message: 'Preparing upload... 0% complete',
        percent: 0,
        label: 'Preparing upload...',
        complete: false,
        inProgress: true,
        selectedCourse,
        lessonTitle
      });

      const formData = new FormData(uploadForm);
      formData.set('course_id', selectedCourse);
      formData.set('instructor_id', instructorId);
      if (lessonTitle) {
        formData.set('title', lessonTitle);
      }

      if (uploadSubmitBtn) {
        uploadSubmitBtn.disabled = true;
        uploadSubmitBtn.setAttribute('aria-busy', 'true');
      }

      // Use XMLHttpRequest to track upload progress
      const xhr = new XMLHttpRequest();
      let uploadTimeout = null;
      let didTimeout = false;
      const UPLOAD_TIMEOUT_MS = 60000; // 60 seconds timeout

      const clearUploadTimeout = () => {
        if (uploadTimeout) {
          clearTimeout(uploadTimeout);
          uploadTimeout = null;
        }
      };

      const armUploadTimeout = () => {
        clearUploadTimeout();
        uploadTimeout = setTimeout(() => {
          didTimeout = true;
          console.error('Upload timeout after', UPLOAD_TIMEOUT_MS, 'ms');
          xhr.abort();
        }, UPLOAD_TIMEOUT_MS);
      };

      xhr.upload.addEventListener('loadstart', () => {
        setUploadProgress(0, 'Starting upload...');
        setFormStatus(uploadStatusEl, 'info', 'Starting upload... 0% complete');
        rememberUploadState({
          type: 'info',
          message: 'Starting upload... 0% complete',
          percent: 0,
          label: 'Starting upload...',
          complete: false,
          inProgress: true,
          selectedCourse,
          lessonTitle
        });
        console.log('Upload started for video:', lessonVideo.name, 'Size:', lessonVideo.size);
        armUploadTimeout();
      });

      xhr.upload.addEventListener('progress', (event) => {
        armUploadTimeout();

        if (event.lengthComputable) {
          const rawPercent = Math.round((event.loaded / event.total) * 100);
          const percentComplete = Math.min(rawPercent, 95);
          const statusMessage = percentComplete >= 95
            ? 'Upload sent. Processing video on the server... 95% complete'
            : `Uploading video... ${percentComplete}% complete`;

          setUploadProgress(percentComplete, percentComplete >= 95 ? 'Processing video...' : 'Uploading video...');
          setFormStatus(uploadStatusEl, 'info', statusMessage);
          rememberUploadState({
            type: 'info',
            message: statusMessage,
            percent: percentComplete,
            label: percentComplete >= 95 ? 'Processing video...' : 'Uploading video...',
            complete: false,
            inProgress: true,
            selectedCourse,
            lessonTitle
          });
        }
      });

      xhr.upload.addEventListener('load', () => {
        armUploadTimeout();
        setUploadProgress(97, 'Finalizing lesson...');
        setFormStatus(uploadStatusEl, 'info', 'Upload received. Finalizing lesson... 97% complete');
        rememberUploadState({
          type: 'info',
          message: 'Upload received. Finalizing lesson... 97% complete',
          percent: 97,
          label: 'Finalizing lesson...',
          complete: false,
          inProgress: true,
          selectedCourse,
          lessonTitle
        });
        if (uploadSubmitBtn) {
          uploadSubmitBtn.setAttribute('aria-busy', 'true');
        }
      });

      const uploadPromise = new Promise((resolve, reject) => {
        xhr.addEventListener('load', () => {
          clearUploadTimeout();
          console.log('XHR load event, status:', xhr.status);
          resolve({ status: xhr.status, data: parseXhrPayload(xhr) });
        });

        xhr.addEventListener('error', () => {
          clearUploadTimeout();
          console.error('XHR error event');
          reject(new Error('Network error during upload'));
        });

        xhr.addEventListener('abort', () => {
          clearUploadTimeout();
          console.error('XHR abort event');
          reject(new Error(didTimeout ? `Upload timed out after ${UPLOAD_TIMEOUT_MS / 1000} seconds` : 'Upload aborted'));
        });

        xhr.open('POST', buildApiUrl('/videos/upload'));
        xhr.setRequestHeader('Accept', 'application/json');
        armUploadTimeout();
        console.log('Sending video upload request to', buildApiUrl('/videos/upload'));
        xhr.send(formData);
      });

      const { status, data } = await uploadPromise;

      console.log('Upload response received, status:', status, 'data:', data);

      if (status < 200 || status >= 300) {
        const failureMessage = buildFailureReason({ ok: false, status }, data, 'Video upload failed. Please try again.');
        console.error('Upload failed with message:', failureMessage);
        setUploadProgress(Math.max(getUploadProgressPercent(), 1), 'Upload failed');
        setFormStatus(uploadStatusEl, 'error', failureMessage);
        showPageToast(failureMessage, 'error', 4200);
        rememberUploadState({
          type: 'error',
          message: failureMessage,
          percent: Math.max(getUploadProgressPercent(), 1),
          label: 'Upload failed',
          complete: false,
          inProgress: false,
          selectedCourse,
          lessonTitle
        });
        scrollUploadFeedbackIntoView();
        return;
      }

      const uploadedVideoId = data?.video?.id;
      let successMessage = 'Lesson video uploaded successfully.';

      try {
        const verification = await verifyUploadedVideo(selectedCourse, uploadedVideoId);
        if (verification.verified) {
          successMessage = `Lesson video uploaded successfully. Total lessons in this course: ${verification.totalVideos}.`;
        } else {
          successMessage = 'Upload response received, but the lesson could not be verified in the course list yet. Please open the course and check once.';
        }
      } catch (verificationError) {
        console.error('Video upload verification error:', verificationError);
        successMessage = `Lesson video uploaded successfully, but verification could not be completed. ${verificationError.message}`;
      }

      setUploadProgress(100, 'Upload complete', { complete: true });
      setFormStatus(uploadStatusEl, 'success', successMessage);
      showPageToast(successMessage, 'success', 3600);
      rememberUploadState({
        type: 'success',
        message: successMessage,
        percent: 100,
        label: 'Upload complete',
        complete: true,
        inProgress: false,
        selectedCourse,
        lessonTitle: ''
      });
      scrollUploadFeedbackIntoView();

      if (lessonTitleInput) {
        lessonTitleInput.value = '';
      }
      if (lessonVideoInput) {
        lessonVideoInput.value = '';
      }
      if (courseSelect) {
        courseSelect.value = String(selectedCourse);
        const selectedOption = courseSelect.options[courseSelect.selectedIndex];
        if (manageCourseTitle && selectedOption) {
          manageCourseTitle.textContent = selectedOption.textContent || 'Selected course';
        }
      }
      
      // Keep the success message visible for 3 seconds before updating dashboard
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('instructor:courseChanged'));
      }, 3000);
    } catch (error) {
      console.error('Video upload error:', error);
      const message = error.message === 'Upload aborted' 
        ? buildNetworkFailureReason('complete the upload')
        : error.message.includes('timeout')
          ? 'Video upload timed out. Please check your internet connection and try again.'
          : buildNetworkFailureReason('upload the video');
      setUploadProgress(Math.max(getUploadProgressPercent(), 1), error.message.includes('timeout') ? 'Upload timed out' : 'Upload failed');
      setFormStatus(uploadStatusEl, 'error', message);
      showPageToast(message, 'error', 4200);
      rememberUploadState({
        type: 'error',
        message,
        percent: Math.max(getUploadProgressPercent(), 1),
        label: error.message.includes('timeout') ? 'Upload timed out' : 'Upload failed',
        complete: false,
        inProgress: false
      });
      scrollUploadFeedbackIntoView();
    } finally {
      isVideoUploadInProgress = false;
      if (uploadSubmitBtn) {
        uploadSubmitBtn.disabled = false;
        uploadSubmitBtn.removeAttribute('aria-busy');
        uploadSubmitBtn.textContent = uploadSubmitBtnDefaultLabel;
      }
    }
  }

  if (uploadForm) {
    uploadForm.addEventListener('submit', handleVideoUpload);
  }

  if (uploadSubmitBtn) {
    uploadSubmitBtn.addEventListener('click', handleVideoUpload);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAddCoursePage);
} else {
  initAddCoursePage();
}

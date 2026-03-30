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

  const instructorId = localStorage.getItem('instructorId');
  if (!instructorId) {
    alert('Please log in as an instructor to manage courses.');
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
    uploadForm.setAttribute('action', 'javascript:void(0)');
    uploadForm.setAttribute('method', 'post');
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
    return `Unable to ${actionLabel} because the backend server could not be reached. Please make sure the server is running on http://localhost:3000.`;
  }

  async function verifyUploadedVideo(courseId, uploadedVideoId) {
    if (!courseId) {
      return { verified: false, totalVideos: 0 };
    }

    const response = await fetch(`http://localhost:3000/api/course-videos/${courseId}`);
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
      const response = await fetch(`http://localhost:3000/api/courses/${instructorId}`);
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
      alert(message);
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
          alert('Please enter a course title.');
          return;
        }
        if (!selectedDuration) {
          setFormStatus(courseStatusEl, 'error', 'Please select a course duration.');
          alert('Please select a course duration.');
          return;
        }
        if (!category) {
          setFormStatus(courseStatusEl, 'error', 'Please enter a category.');
          alert('Please enter a category.');
          return;
        }
        if (!description) {
          setFormStatus(courseStatusEl, 'error', 'Please enter a course description.');
          alert('Please enter a course description.');
          return;
        }

        if (!isEditing && !cover) {
          setFormStatus(courseStatusEl, 'error', 'Please select a cover image.');
          alert('Please select a cover image.');
          return;
        }

        const allowedImageTypes = ['image/jpeg', 'image/png', 'image/jpg'];
        if (cover && !allowedImageTypes.includes(cover.type)) {
          setFormStatus(courseStatusEl, 'error', 'Please upload a valid image file (jpg, jpeg, png).');
          alert('Please upload a valid image file (jpg, jpeg, png).');
          return;
        }

        const formData = new FormData(createForm);
        formData.set('instructor_id', instructorId);
        formData.set('description', description);
        formData.set('duration_days', selectedDuration.value);

        const response = isEditing
          ? await fetch(`http://localhost:3000/api/courses/${editingCourseId}`, {
              method: 'PUT',
              body: formData
            })
          : await fetch('http://localhost:3000/courses', {
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
          alert(failureMessage);
          return;
        }

        if (isEditing) {
          setFormStatus(courseStatusEl, 'success', 'Course updated successfully.');
          alert('Course updated successfully!');
          clearEditMode();
        } else {
          pendingCourseId = data.courseId ? String(data.courseId) : pendingCourseId;
          setFormStatus(courseStatusEl, 'success', 'Course created successfully. You can upload lesson videos now.');
          alert('Course created successfully! Now upload lesson videos.');
        }
        createForm.reset();
        clearEditMode();
        loadInstructorCourses();
        window.dispatchEvent(new CustomEvent('instructor:courseChanged'));
      } catch (error) {
        console.error('Course create error:', error);
        const message = buildNetworkFailureReason(isEditing ? 'update the course' : 'create the course');
        setFormStatus(courseStatusEl, 'error', message);
        alert(message);
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
      const lessonTitle = document.getElementById('lessonTitle').value.trim();
      const lessonVideo = document.getElementById('lessonVideo').files[0];

      if (!selectedCourse) {
        resetUploadProgress();
        setFormStatus(uploadStatusEl, 'error', 'Please select a course.');
        return;
      }

      if (!lessonVideo) {
        resetUploadProgress();
        setFormStatus(uploadStatusEl, 'error', 'Please select a video file to upload.');
        return;
      }

      if (lessonVideo.type && !lessonVideo.type.startsWith('video/')) {
        resetUploadProgress();
        setFormStatus(uploadStatusEl, 'error', `Please upload a valid video file. Selected type: ${lessonVideo.type}`);
        return;
      }

      if (lessonVideo.size > MAX_VIDEO_SIZE_BYTES) {
        resetUploadProgress();
        setFormStatus(uploadStatusEl, 'error', 'Video upload failed: file size exceeds the 100MB limit.');
        return;
      }

      setFormStatus(uploadStatusEl, 'info', 'Preparing upload... 0% complete');
      resetUploadProgress();
      setUploadProgress(0, 'Preparing upload...');

      const formData = new FormData(uploadForm);
      formData.set('course_id', selectedCourse);
      formData.set('instructor_id', instructorId);
      if (lessonTitle) {
        formData.set('title', lessonTitle);
      }

      if (uploadSubmitBtn) {
        uploadSubmitBtn.disabled = true;
        uploadSubmitBtn.textContent = 'Uploading... 0%';
      }

      // Use XMLHttpRequest to track upload progress
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('loadstart', () => {
        setUploadProgress(0, 'Starting upload...');
        setFormStatus(uploadStatusEl, 'info', 'Starting upload... 0% complete');
      });

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const rawPercent = Math.round((event.loaded / event.total) * 100);
          const percentComplete = Math.min(rawPercent, 95);
          const statusMessage = percentComplete >= 95
            ? 'Upload sent. Processing video on the server... 95% complete'
            : `Uploading video... ${percentComplete}% complete`;

          setUploadProgress(percentComplete, percentComplete >= 95 ? 'Processing video...' : 'Uploading video...');
          setFormStatus(uploadStatusEl, 'info', statusMessage);
          if (uploadSubmitBtn) {
            uploadSubmitBtn.textContent = `Uploading... ${percentComplete}%`;
          }
        }
      });

      xhr.upload.addEventListener('load', () => {
        setUploadProgress(97, 'Finalizing lesson...');
        setFormStatus(uploadStatusEl, 'info', 'Upload received. Finalizing lesson... 97% complete');
        if (uploadSubmitBtn) {
          uploadSubmitBtn.textContent = 'Finalizing...';
        }
      });

      const uploadPromise = new Promise((resolve, reject) => {
        xhr.addEventListener('load', () => {
          resolve({ status: xhr.status, data: parseXhrPayload(xhr) });
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error during upload'));
        });

        xhr.addEventListener('abort', () => {
          reject(new Error('Upload aborted'));
        });

        xhr.open('POST', 'http://localhost:3000/videos/upload');
        xhr.send(formData);
      });

      const { status, data } = await uploadPromise;

      if (status < 200 || status >= 300) {
        const failureMessage = buildFailureReason({ ok: false, status }, data, 'Video upload failed. Please try again.');
        resetUploadProgress();
        setFormStatus(uploadStatusEl, 'error', failureMessage);
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

      if (uploadStatusEl) {
        uploadStatusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      const lessonTitleInput = document.getElementById('lessonTitle');
      const lessonVideoInput = document.getElementById('lessonVideo');
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
      }, 2000);
    } catch (error) {
      console.error('Video upload error:', error);
      const message = buildNetworkFailureReason('upload the video');
      resetUploadProgress();
      setFormStatus(uploadStatusEl, 'error', message);
    } finally {
      isVideoUploadInProgress = false;
      if (uploadSubmitBtn) {
        uploadSubmitBtn.disabled = false;
        uploadSubmitBtn.textContent = 'Upload Video';
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

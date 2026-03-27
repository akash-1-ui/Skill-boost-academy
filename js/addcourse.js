document.addEventListener('DOMContentLoaded', () => {
  const createForm = document.getElementById('createCourseForm');
  const uploadForm = document.getElementById('uploadVideoForm');
  const courseSelect = document.getElementById('courseSelect');
  const coverInput = document.getElementById('cover');
  const coverEditHint = document.getElementById('coverEditHint');
  const submitBtn = document.getElementById('courseSubmitBtn');
  const manageCourseTitle = document.getElementById('manageCourseTitle');
  const durationInputs = Array.from(document.querySelectorAll('input[name="duration_days"]'));
  let editingCourseId = null;
  let pendingCourseId = null;

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

  async function loadInstructorCourses() {
    if (!courseSelect) return;
    courseSelect.innerHTML = '<option value="">Loading courses...</option>';
    try {
      const response = await fetch(`http://localhost:3000/api/courses/${instructorId}`);
      const data = await response.json();
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
    }
  }

  loadInstructorCourses();

  if (createForm) {
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const isEditing = Boolean(editingCourseId);
      const actionLabel = isEditing ? 'update' : 'creation';

      try {
        const title = document.getElementById('title')?.value.trim() || '';
        const durationInputs = Array.from(document.querySelectorAll('input[name="duration_days"]'));
        const selectedDuration = durationInputs.find((input) => input.checked);
        const cover = document.getElementById('cover').files[0];
        const category = document.getElementById('category')?.value.trim() || '';
        const description = document.getElementById('description')?.value.trim() || '';

        console.log('Form validation:', { title, selectedDuration, cover, category, description, durationInputs: durationInputs.length });

        if (!title) {
          alert('Please enter a course title.');
          return;
        }
        if (!selectedDuration) {
          alert('Please select a course duration.');
          return;
        }
        if (!category) {
          alert('Please enter a category.');
          return;
        }
        if (!description) {
          alert('Please enter a course description.');
          return;
        }

        if (!isEditing && !cover) {
          alert('Please select a cover image.');
          return;
        }

        const allowedImageTypes = ['image/jpeg', 'image/png', 'image/jpg'];
        if (cover && !allowedImageTypes.includes(cover.type)) {
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

        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json')
          ? await response.json()
          : { error: 'Unexpected response type', details: await response.text() };

        if (!response.ok) {
          alert(data.error || data.message || `Course ${actionLabel} failed. Please try again.`);
          return;
        }

        if (isEditing) {
          alert('Course updated successfully!');
          clearEditMode();
        } else {
          pendingCourseId = data.courseId ? String(data.courseId) : pendingCourseId;
          alert('Course created successfully! Now upload lesson videos.');
        }
        createForm.reset();
        clearEditMode();
        loadInstructorCourses();
        window.dispatchEvent(new CustomEvent('instructor:courseChanged'));
      } catch (error) {
        console.error('Course create error:', error);
        alert(error.message || `An error occurred while ${isEditing ? 'updating' : 'creating'} the course. Please try again.`);
      }
    });
  }

  if (uploadForm) {
    uploadForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      try {
        const selectedCourse = courseSelect?.value;
        const lessonTitle = document.getElementById('lessonTitle').value.trim();
        const lessonVideo = document.getElementById('lessonVideo').files[0];

        if (!selectedCourse) {
          alert('Please select a course.');
          return;
        }

        if (!lessonVideo) {
          alert('Please select a video file to upload.');
          return;
        }

        const allowedVideoTypes = ['video/mp4', 'video/webm', 'video/ogg'];
        if (!allowedVideoTypes.includes(lessonVideo.type)) {
          alert('Please upload a valid video file (mp4, webm, ogg).');
          return;
        }

        const formData = new FormData(uploadForm);
        formData.set('course_id', selectedCourse);
        formData.set('instructor_id', instructorId);
        if (lessonTitle) {
          formData.set('title', lessonTitle);
        }

        const response = await fetch('http://localhost:3000/videos/upload', {
          method: 'POST',
          body: formData
        });

        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json')
          ? await response.json()
          : { error: 'Unexpected response type', details: await response.text() };

        if (!response.ok) {
          alert(data.error || data.message || 'Video upload failed. Please try again.');
          return;
        }

        alert('Lesson video uploaded successfully!');
        uploadForm.reset();
        window.dispatchEvent(new CustomEvent('instructor:courseChanged'));
      } catch (error) {
        console.error('Video upload error:', error);
        alert(error.message || 'An error occurred while uploading the video. Please try again.');
      }
    });
  }
});

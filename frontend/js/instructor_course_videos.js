const params = new URLSearchParams(window.location.search);
const courseIdParam = params.get('courseId');
const courseId = Number(courseIdParam);

const instructorId = localStorage.getItem('instructorId');
if (!instructorId) {
  window.location.href = 'login.html?role=instructor';
}

if (!courseId) {
  window.location.href = 'instructor_home.html';
}

const instructorName = localStorage.getItem('instructorName') || '';
const instructorEmail = localStorage.getItem('instructorEmail') || '';
const instructorPill = document.getElementById('instructorPill');
if (instructorPill) {
  instructorPill.textContent = '';
  instructorPill.style.display = 'none';
}

const courseTitleEl = document.getElementById('courseTitle');
const courseDescriptionEl = document.getElementById('courseDescription');
const lessonCountEl = document.getElementById('lessonCount');
const videoListEl = document.getElementById('videoList');
const player = document.getElementById('coursePlayer');
const currentVideoTitleEl = document.getElementById('currentVideoTitle');
const videoStatusEl = document.getElementById('videoStatus');
const placeholderEl = document.getElementById('playerPlaceholder');
const editVideoBtn = document.getElementById('editVideoBtn');
const deleteVideoBtn = document.getElementById('deleteVideoBtn');

const addVideoBtn = document.getElementById('addVideoBtn');
const editCourseBtn = document.getElementById('editCourseBtn');
const deleteCourseBtn = document.getElementById('deleteCourseBtn');

const editModal = document.getElementById('videoEditModal');
const editModalClose = document.getElementById('closeEditModal');
const editModalCancel = document.getElementById('cancelEditVideo');
const editForm = document.getElementById('videoEditForm');
const editTitleInput = document.getElementById('editVideoTitle');
const editFileInput = document.getElementById('editVideoFile');
const API_BASE = window.SkillBoostApp?.apiBase || window.location.origin;
const buildApiUrl = window.SkillBoostApp?.buildApiUrl
  || ((path = '') => `${API_BASE}${String(path || '').startsWith('/') ? path : `/${path}`}`);
const showPageToast = (message, tone = 'info', durationMs = 3200) => {
  window.SkillBoostPageToast?.show?.(message, tone, durationMs);
};

let videos = [];
let currentVideo = null;

function isNumericId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

function resolveAssetPath(rawPath, fallbackBase) {
  if (!rawPath) return '';
  let value = String(rawPath).trim();
  if (!value) return '';
  value = value.replace(/\\/g, '/');
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) {
    return value;
  }

  const normalizedBase = API_BASE || window.location.origin;
  const normalizedFallback = fallbackBase.startsWith('/') ? fallbackBase : `/${fallbackBase}`;

  if (/^[a-zA-Z]:\//.test(value)) {
    const filename = value.split('/').pop();
    return `${normalizedBase}${normalizedFallback}/${filename}`;
  }

  if (value.startsWith('/')) {
    return `${normalizedBase}${value}`;
  }

  if (value.startsWith('videos/')) {
    return `${normalizedBase}/${value}`;
  }

  if (value.startsWith('uploads/')) {
    return `${normalizedBase}/${value}`;
  }

  return `${normalizedBase}${normalizedFallback}/${value}`;
}

function showPlaceholder(shouldShow) {
  if (!placeholderEl) return;
  if (shouldShow) {
    placeholderEl.classList.remove('hidden');
  } else {
    placeholderEl.classList.add('hidden');
  }
}

function updateVideoStatus(video) {
  if (!videoStatusEl) return;
  if (!video) {
    videoStatusEl.textContent = '';
    return;
  }

  if (!isNumericId(video.id)) {
    videoStatusEl.textContent = 'Legacy upload';
    return;
  }

  videoStatusEl.textContent = 'Ready to preview';
}

function setVideoActionsEnabled(enabled) {
  if (editVideoBtn) {
    editVideoBtn.disabled = !enabled;
  }
  if (deleteVideoBtn) {
    deleteVideoBtn.disabled = !enabled;
  }
}

function setActiveVideo(video) {
  if (!video || !player) return;
  currentVideo = video;
  const resolvedPath = resolveAssetPath(video.video_path || video.video, '/videos');
  if (!resolvedPath) {
    showPlaceholder(true);
    setVideoActionsEnabled(false);
    return;
  }

  player.pause();
  player.src = resolvedPath;
  player.load();
  player.play().catch(() => {});

  if (currentVideoTitleEl) {
    currentVideoTitleEl.textContent = video.title || 'Lesson';
  }

  updateVideoStatus(video);
  showPlaceholder(false);
  setVideoActionsEnabled(isNumericId(video.id));
  renderPlaylist();
}

function renderPlaylist() {
  if (!videoListEl) return;
  videoListEl.innerHTML = '';

  if (videos.length === 0) {
    videoListEl.innerHTML = '<div class="playlist-empty">No lessons available yet.</div>';
    return;
  }

  videos.forEach((video, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'playlist-item';
    if (currentVideo && String(video.id) === String(currentVideo.id)) {
      item.classList.add('active');
    }

    item.innerHTML = `
      <span class="playlist-index">${index + 1}</span>
      <span class="playlist-text">
        <span class="playlist-title">${video.title || 'Lesson'}</span>
      </span>
    `;

    item.addEventListener('click', () => setActiveVideo(video));
    videoListEl.appendChild(item);
  });
}

async function loadCourseDetails() {
  try {
    const response = await fetch(buildApiUrl(`/api/course/${courseId}`));
    if (!response.ok) {
      throw new Error('Course not found');
    }
    const course = await response.json();
    if (courseTitleEl) {
      courseTitleEl.textContent = course.title || 'Course';
    }
    if (courseDescriptionEl) {
      courseDescriptionEl.textContent = course.description || 'No description provided yet.';
    }

    // Set course cover as background on body
    if (course.cover_path || course.cover) {
      const coverUrl = resolveAssetPath(course.cover_path || course.cover, '/uploads/covers');
      if (coverUrl) {
        document.body.style.backgroundImage = `url('${coverUrl}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
        document.body.style.backgroundAttachment = 'fixed';
        document.body.style.backgroundRepeat = 'no-repeat';
      }
    }

    return true;
  } catch (error) {
    if (courseTitleEl) {
      courseTitleEl.textContent = 'Course not found';
    }
    if (courseDescriptionEl) {
      courseDescriptionEl.textContent = 'Please return to the dashboard and try again.';
    }
    if (videoListEl) {
      videoListEl.innerHTML = '<div class="playlist-empty">Course not found.</div>';
    }
    setVideoActionsEnabled(false);
    return false;
  }
}

async function loadVideos(selectedId) {
  try {
    const response = await fetch(buildApiUrl(`/api/course-videos/${courseId}`));
    if (!response.ok) {
      throw new Error('Failed to load videos');
    }
    const payload = await response.json();
    videos = Array.isArray(payload.videos) ? payload.videos : [];
    renderPlaylist();
    if (lessonCountEl) {
      lessonCountEl.textContent = videos.length;
    }
    if (videos.length > 0) {
      const selected = videos.find((video) => String(video.id) === String(selectedId)) || videos[0];
      setActiveVideo(selected);
    } else {
      showPlaceholder(true);
      setVideoActionsEnabled(false);
      if (videoStatusEl) {
        videoStatusEl.textContent = '';
      }
      if (currentVideoTitleEl) {
        currentVideoTitleEl.textContent = 'No videos uploaded yet';
      }
    }
  } catch (error) {
    if (videoListEl) {
      videoListEl.innerHTML = '<div class="playlist-empty">Failed to load videos.</div>';
    }
    if (currentVideoTitleEl) {
      currentVideoTitleEl.textContent = 'Unable to load videos';
    }
    if (videoStatusEl) {
      videoStatusEl.textContent = '';
    }
  }
}

function openEditModal() {
  if (!editModal || !editTitleInput) return;
  if (!currentVideo || !isNumericId(currentVideo.id)) return;
  editTitleInput.value = currentVideo.title || '';
  if (editFileInput) {
    editFileInput.value = '';
  }
  editModal.classList.add('open');
  editModal.setAttribute('aria-hidden', 'false');
  editTitleInput.focus();
}

function closeEditModal() {
  if (!editModal) return;
  editModal.classList.remove('open');
  editModal.setAttribute('aria-hidden', 'true');
}

async function updateVideo() {
  if (!currentVideo || !isNumericId(currentVideo.id)) return;
  const title = editTitleInput ? editTitleInput.value.trim() : '';
  if (!title) {
    showPageToast('Please enter a lesson title.', 'warning', 3200);
    return;
  }

  const hasNewFile = Boolean(editFileInput && editFileInput.files && editFileInput.files[0]);

  try {
    const response = hasNewFile
      ? await fetch(buildApiUrl(`/api/course-videos/${currentVideo.id}`), {
          method: 'PUT',
          body: (() => {
            const formData = new FormData();
            formData.set('title', title);
            formData.set('instructor_id', instructorId);
            formData.set('video', editFileInput.files[0]);
            return formData;
          })()
        })
      : await fetch(buildApiUrl(`/api/course-videos/${currentVideo.id}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            instructor_id: instructorId
          })
        });

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : { error: 'Unexpected response type', details: await response.text() };

    if (!response.ok) {
      showPageToast(data.error || data.message || 'Failed to update video.', 'error', 4200);
      return;
    }

    closeEditModal();
    await loadVideos(currentVideo.id);
    showPageToast('Video updated successfully.', 'success', 2800);
  } catch (error) {
    console.error('Video update error:', error);
    showPageToast(error.message || 'Failed to update video. Please try again.', 'error', 4200);
  }
}

async function deleteVideo() {
  if (!currentVideo || !isNumericId(currentVideo.id)) return;
  if (!confirm('Delete this video? This cannot be undone.')) {
    return;
  }

  try {
    const response = await fetch(buildApiUrl(`/api/course-videos/${currentVideo.id}?instructorId=${encodeURIComponent(instructorId)}`),
      { method: 'DELETE' }
    );

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : { error: 'Unexpected response type', details: await response.text() };

    if (!response.ok) {
      showPageToast(data.error || data.message || 'Failed to delete video.', 'error', 4200);
      return;
    }

    currentVideo = null;
    await loadVideos();
    showPageToast('Video deleted successfully.', 'success', 2800);
  } catch (error) {
    console.error('Video delete error:', error);
    showPageToast(error.message || 'Failed to delete video. Please try again.', 'error', 4200);
  }
}

async function deleteCourse() {
  if (!confirm('Delete this course and all its videos? This cannot be undone.')) {
    return;
  }

  try {
    const response = await fetch(buildApiUrl(`/api/courses/${courseId}`), {
      method: 'DELETE'
    });

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : { error: 'Unexpected response type', details: await response.text() };

    if (!response.ok) {
      showPageToast(data.error || data.message || 'Failed to delete course.', 'error', 4200);
      return;
    }

    showPageToast('Course deleted successfully. Returning to the dashboard...', 'success', 2200);
    window.setTimeout(() => {
      window.location.href = 'instructor_home.html';
    }, 900);
  } catch (error) {
    console.error('Course delete error:', error);
    showPageToast(error.message || 'Failed to delete course. Please try again.', 'error', 4200);
  }
}

if (addVideoBtn) {
  addVideoBtn.href = `instructor_home.html?manageCourseId=${courseId}#add-course-video`;
}

if (editCourseBtn) {
  editCourseBtn.href = `instructor_home.html?editCourseId=${courseId}#add-course`;
}

if (deleteCourseBtn) {
  deleteCourseBtn.addEventListener('click', deleteCourse);
}

if (editVideoBtn) {
  editVideoBtn.addEventListener('click', openEditModal);
}

if (deleteVideoBtn) {
  deleteVideoBtn.addEventListener('click', deleteVideo);
}

if (editModal) {
  editModal.addEventListener('click', (event) => {
    if (event.target === editModal) {
      closeEditModal();
    }
  });
}

if (editModalClose) {
  editModalClose.addEventListener('click', closeEditModal);
}

if (editModalCancel) {
  editModalCancel.addEventListener('click', closeEditModal);
}

if (editForm) {
  editForm.addEventListener('submit', (event) => {
    event.preventDefault();
    updateVideo();
  });
}

if (player) {
  player.addEventListener('loadedmetadata', () => {
    showPlaceholder(false);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadCourseDetails().then((isValid) => {
    if (isValid) {
      loadVideos();
    }
  });
  setVideoActionsEnabled(false);
});

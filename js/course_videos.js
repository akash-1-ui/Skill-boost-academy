const pageParams = new URLSearchParams(window.location.search);
const courseIdParam = pageParams.get('courseId');
const courseId = Number(courseIdParam);
const shouldResume = pageParams.get('resume') === '1';

if (!courseId) {
  window.location.href = 'student_home.html';
}

const studentEmail = localStorage.getItem('studentEmail') || '';
const studentName = studentEmail ? (localStorage.getItem(`studentName_${studentEmail}`) || '') : '';
const studentNamePill = document.getElementById('studentNamePill');
if (studentNamePill) {
  studentNamePill.textContent = '';
  studentNamePill.style.display = 'none';
}

const courseTitleEl = document.getElementById('courseTitle');
const courseDescriptionEl = document.getElementById('courseDescription');
const courseInstructorEl = document.getElementById('courseInstructor');
const lessonCountEl = document.getElementById('lessonCount');
const videoListEl = document.getElementById('videoList');
const player = document.getElementById('coursePlayer');
const currentVideoTitleEl = document.getElementById('currentVideoTitle');
const watchStatusEl = document.getElementById('watchStatus');
const placeholderEl = document.getElementById('playerPlaceholder');
const API_BASE = window.SkillBoostApp?.apiBase || window.location.origin;
const buildApiUrl = window.SkillBoostApp?.buildApiUrl
  || ((path = '') => `${API_BASE}${String(path || '').startsWith('/') ? path : `/${path}`}`);

let videos = [];
let currentVideo = null;
let watchTimer = null;
let sessionSeconds = 0;

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
    if (courseInstructorEl && course.instructor_name) {
      courseInstructorEl.textContent = `By ${course.instructor_name}`;
      courseInstructorEl.style.display = 'block';
    }
    if (course.cover_path || course.cover) {
      const coverPath = resolveAssetPath(course.cover_path || course.cover, '/uploads/covers');
      document.body.style.backgroundImage = `url('${coverPath}')`;
    }
  } catch (error) {
    if (courseTitleEl) {
      courseTitleEl.textContent = 'Course not found';
    }
    if (courseDescriptionEl) {
      courseDescriptionEl.textContent = 'Please return to the dashboard and try again.';
    }
  }
}

async function loadVideos() {
  try {
    const query = studentEmail ? `?studentEmail=${encodeURIComponent(studentEmail)}` : '';
    const response = await fetch(buildApiUrl(`/api/course-videos/${courseId}${query}`));
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
      const initialVideo = shouldResume
        ? videos.find((video) => !Number(video.is_watched)) || videos[0]
        : videos[0];
      setActiveVideo(initialVideo);
    } else {
      showPlaceholder(true);
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
  }
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
    if (video.is_watched) {
      item.classList.add('is-watched');
    }
    if (currentVideo && video.id === currentVideo.id) {
      item.classList.add('active');
    }
    item.dataset.videoId = video.id;

    item.innerHTML = `
      <span class="playlist-index">${index + 1}</span>
      <span class="playlist-text">
        <span class="playlist-title">${video.title || 'Lesson'}</span>
        <span class="playlist-status">${video.is_watched ? 'Watched' : 'Not watched'}</span>
      </span>
    `;

    item.addEventListener('click', () => setActiveVideo(video));
    videoListEl.appendChild(item);
  });
}

function setActiveVideo(video) {
  if (!video || !player) return;
  currentVideo = video;
  const resolvedPath = resolveAssetPath(video.video_path || video.video, '/videos');
  if (!resolvedPath) {
    showPlaceholder(true);
    return;
  }

  player.pause();
  player.src = resolvedPath;
  player.load();
  player.play().catch(() => {});

  if (currentVideoTitleEl) {
    currentVideoTitleEl.textContent = video.title || 'Lesson';
  }
  updateWatchStatus(video.is_watched);
  showPlaceholder(false);
  renderPlaylist();
}

function updateWatchStatus(isWatched) {
  if (!watchStatusEl) return;
  if (isWatched) {
    watchStatusEl.textContent = 'Watched';
    watchStatusEl.classList.add('is-watched');
  } else {
    watchStatusEl.textContent = 'In progress';
    watchStatusEl.classList.remove('is-watched');
  }
}

function showPlaceholder(shouldShow) {
  if (!placeholderEl) return;
  if (shouldShow) {
    placeholderEl.classList.remove('hidden');
  } else {
    placeholderEl.classList.add('hidden');
  }
}

function startTimer() {
  if (watchTimer) return;
  watchTimer = setInterval(() => {
    sessionSeconds += 1;
  }, 1000);
}

function stopTimer() {
  if (!watchTimer) return;
  clearInterval(watchTimer);
  watchTimer = null;
  flushTime();
}

function flushTime() {
  if (sessionSeconds <= 0) return;
  updateLocalTimeSpent(sessionSeconds);
  sendCourseView(sessionSeconds);
  sessionSeconds = 0;
}

function updateLocalTimeSpent(seconds) {
  if (!studentEmail) return;
  const key = `timeSpent_${studentEmail}`;
  const existing = JSON.parse(localStorage.getItem(key) || '{}');
  const current = Number(existing[courseId] || 0);
  existing[courseId] = current + seconds;
  localStorage.setItem(key, JSON.stringify(existing));
}

function sendCourseView(seconds) {
  if (!studentEmail) return;
  fetch(buildApiUrl('/api/course-view'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentEmail, courseId, timeSpent: Math.round(seconds) })
  }).catch(() => {});
}

async function markWatched(video) {
  if (!studentEmail || !video) return;
  if (!Number.isInteger(Number(video.id))) return;
  if (video.is_watched) return;

  try {
    await fetch(buildApiUrl('/api/course-video-progress'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentEmail,
        videoId: video.id,
        isWatched: 1
      })
    });
    video.is_watched = 1;
    updateWatchStatus(true);
    renderPlaylist();
  } catch (error) {
    console.error('Failed to update progress', error);
  }
}

if (player) {
  player.addEventListener('play', startTimer);
  player.addEventListener('pause', stopTimer);
  player.addEventListener('ended', () => {
    stopTimer();
    markWatched(currentVideo);
  });
}

window.addEventListener('beforeunload', () => {
  stopTimer();
  flushTime();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && player && !player.paused) {
    player.pause();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  loadCourseDetails();
  loadVideos();
});

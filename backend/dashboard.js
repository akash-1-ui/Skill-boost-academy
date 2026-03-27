// Replace this with instructor's ID (from localStorage or backend)
const instructorId = 1;

fetch(`http://localhost:3000/api/courses/${instructorId}`)
  .then(res => res.json())
  .then(courses => {
    const tbody = document.querySelector('.course-table tbody');
    tbody.innerHTML = '';
    courses.forEach(course => {
      const row = `
        <tr>
          <td>${course.title}</td>
          <td>${course.category}</td>
          <td>${course.enrolled_students}</td>
          <td>
            <button onclick="editCourse(${course.id})">Edit</button>
            <button onclick="deleteCourse(${course.id})">Delete</button>
          </td>
        </tr>
      `;
      tbody.innerHTML += row;
    });
  });

// ==================== LOAD EVENTS FROM BACKEND ====================

async function loadEvents() {
  try {
    const response = await fetch("http://localhost:5000/api/events");
    const data = await response.json();

    if (!data.success) {
      console.error("Failed to fetch events");
      return;
    }

    const grid = document.getElementById("event-grid");
    grid.innerHTML = "";

    data.events.forEach(ev => {
      const card = document.createElement("div");
      card.className = "event-card";
      card.innerHTML = `
        <img src="${ev.icon}" alt="${ev.title}">
        <h3>${ev.title}</h3>
      `;

      // 🟢 When clicked, go to plans.html (passing selected event via URL)
      card.addEventListener("click", () => {
        window.location.href = `plans.html?event=${encodeURIComponent(ev.title)}`;
      });

      grid.appendChild(card);
    });
  } catch (error) {
    console.error("Error fetching events:", error);
  }
}

document.addEventListener("DOMContentLoaded", loadEvents);


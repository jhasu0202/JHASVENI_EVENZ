// ==================== EVENTS ====================

// Fetch and display events
async function loadEvents() {
  try {
    const response = await fetch("http://localhost:5000/api/events");
    const data = await response.json();

    if (data.success) {
      const container = document.getElementById("events-list");
      if (!container) return; // only run if events-list exists
      container.innerHTML = "";

      data.events.forEach(event => {
        const div = document.createElement("div");
        div.className = "event-card";
        div.innerHTML = `
          <h3>${event.name}</h3>
          <p><strong>Date:</strong> ${new Date(event.date).toLocaleDateString()}</p>
          <p><strong>Location:</strong> ${event.location}</p>
          <p>${event.description}</p>
        `;
        container.appendChild(div);
      });
    }
  } catch (error) {
    console.error("Error loading events:", error);
  }
}

// Add new event
async function addEvent(e) {
  e.preventDefault();
  const name = document.getElementById("event-name").value.trim();
  const date = document.getElementById("event-date").value;
  const location = document.getElementById("event-location").value.trim();
  const description = document.getElementById("event-description").value.trim();

  if (!name || !date || !location || !description) {
    alert("All fields are required!");
    return;
  }

  try {
    const response = await fetch("http://localhost:5000/api/add-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, date, location, description }),
    });

    const data = await response.json();
    alert(data.message);
    if (data.success) window.location.href = "events.html";
  } catch (err) {
    console.error("Error submitting event:", err);
    alert("Failed to submit event. Please try again.");
  }
}

// ==================== FAQ ====================
async function loadFAQ() {
  try {
    const response = await fetch("http://localhost:5000/api/faq");
    const data = await response.json();

    if (data.success) {
      const container = document.getElementById("faq-list");
      if (!container) return;
      container.innerHTML = "";

      data.data.forEach(faq => {
        const div = document.createElement("div");
        div.className = "faq-item";
        div.innerHTML = `
          <h4>${faq.question}</h4>
          <p>${faq.answer}</p>
        `;
        container.appendChild(div);
      });
    }
  } catch (err) {
    console.error("Error loading FAQ:", err);
  }
}

// ==================== CHAT ====================
async function loadChat(coordinatorId) {
  try {
    const response = await fetch(`http://localhost:5000/api/chat/${coordinatorId}`);
    const data = await response.json();

    if (data.success) {
      const container = document.getElementById("chat-messages");
      if (!container) return;
      container.innerHTML = "";

      data.messages.forEach(msg => {
        const div = document.createElement("div");
        div.className = msg.sender === "user" ? "chat-message user" : "chat-message coordinator";
        div.innerHTML = `
          <span class="chat-sender">${msg.sender}</span>: 
          <span class="chat-text">${msg.message}</span>
          <span class="chat-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
        `;
        container.appendChild(div);
      });
      container.scrollTop = container.scrollHeight;
    }
  } catch (err) {
    console.error("Error loading chat:", err);
  }
}

async function sendMessage(coordinatorId) {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;

  try {
    const response = await fetch(`http://localhost:5000/api/chat/${coordinatorId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "user", text }),
    });
    const data = await response.json();
    if (data.success) {
      input.value = "";
      loadChat(coordinatorId);
    } else {
      alert(data.message);
    }
  } catch (err) {
    console.error("Error sending chat message:", err);
  }
}

// ==================== FEEDBACK / SUPPORT ====================
async function submitFeedback(e) {
  e.preventDefault();
  const name = document.getElementById("feedback-name").value.trim();
  const email = document.getElementById("feedback-email").value.trim();
  const rating = document.getElementById("feedback-rating").value;
  const message = document.getElementById("feedback-message").value.trim();

  if (!name || !email || !rating || !message) {
    alert("All fields are required!");
    return;
  }

  try {
    const response = await fetch("http://localhost:5000/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, rating, message }),
    });

    const data = await response.json();
    alert(data.message);
    if (data.success) document.getElementById("feedback-form").reset();
  } catch (err) {
    console.error("Error submitting feedback:", err);
    alert("Failed to submit feedback. Please try again.");
  }
}

async function submitSupport(e) {
  e.preventDefault();
  const email = document.getElementById("support-email").value.trim();
  const message = document.getElementById("support-message").value.trim();

  if (!email || !message) {
    alert("Both email and message are required!");
    return;
  }

  try {
    const response = await fetch("http://localhost:5000/api/contact-support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, message }),
    });

    const data = await response.json();
    alert(data.message);
    if (data.success) document.getElementById("support-form").reset();
  } catch (err) {
    console.error("Error submitting support request:", err);
    alert("Failed to submit support request. Please try again.");
  }
}

// ==================== UTILITY ====================
function initPage() {
  if (document.getElementById("events-list")) loadEvents();
  if (document.getElementById("faq-list")) loadFAQ();
}

// Initialize on page load
document.addEventListener("DOMContentLoaded", initPage);


# JHASVENI_EVENZ 
🎉 Even'Z – Event Management Platform (Frontend)

A complete event-booking and management web application built with HTML, CSS, JavaScript, designed with a purple neon UI theme and includes both User Side and Admin Dashboard.

🚀 Overview

Even'Z is an end-to-end event-booking frontend application.
Users can:

Browse and explore events

View event details

Book plans & manage bookings

Select cities, dates & checkout

View booking history

Chat, receive notifications

Contact support

Manage user profile

Admins can:

Manage events

Manage users

Manage bookings

View analytics & charts

Create coupons

View and reply to feedback

🧩 Tech Stack
Layer	Technology
Frontend	HTML5, CSS3, JavaScript
Design Theme	Purple Neon UI
Icons	FontAwesome
Fonts	Google Fonts (Poppins)
Charts	Chart.js (Admin Dashboard)
Local Storage	Used for test data in Add Event page
API Ready	Frontend integrates with backend via REST API (e.g., /api/bookings, /api/cart, /api/events)
📁 Project Structure
frontend/
│── mainpage.html
│── events.html
│── explore_events.html
│── event-details.html
│── citypage.html
│── calendarpage.html
│── cartpage.html
│── checkoutpage.html
│── agreementpage.html
│── receiptpage.html
│── plans.html
│── userprofile_settingpage.html
│── user_booking_history.html
│── notificationspage.html
│── message_chatpage.html
│── feedbackpage.html
│── faq_helppage.html
│── contactsupportpage.html
│── contact.html
│── about.html
│── add-event.html
│── admindashboard.html
│── Loginpage.html
│── forgot passs.html
│── reset-pass.html
│── sign up.html
│
│── style.css
│── script.js

🌟 Key Features
⭐ User Features

Browse events with category & city selection

Animated UI and smooth transitions

Event plans with pricing

Cart system

Checkout page connected to backend (/api/bookings/...)

PDF-like receipt page

Event agreement with accordion terms

Booking history page

Profile settings page

Notifications & chat page

Full neon UI theme for every page

⭐ Admin Features

Admin Dashboard (admindashboard.html)

Total Users / Events / Bookings / Revenue stats

Revenue line charts

Plan and city analytics charts

Add / Edit / Delete Events

Manage Users

Manage Bookings

Create Coupons

Reply to Feedback

Export Users as CSV

🔗 API Endpoints Used

Frontend communicates with backend via REST API such as:

Bookings

GET /api/bookings/:id

POST /api/bookings

Cart

GET /api/cart/:userId

Events

GET /api/events

POST /api/events (Admin)

Users

GET /api/admin/users

Dashboard

GET /api/admin/overview

Coupons

POST /api/admin/coupons

These endpoints can be updated based on your backend structure.

▶️ How to Run Locally

Clone the repository:

git clone https://github.com/your-username/evenz-frontend.git
cd evenz-frontend


Open mainpage.html directly in the browser
OR use a live server:

npx serve


or VS Code “Live Server” extension.

📸 Pages Included

✔ Landing Page
✔ Event Explore Page
✔ Event Details
✔ Checkout + Cart
✔ Payment Confirmation
✔ Calendar Page
✔ Profile
✔ Booking History
✔ Support / Contact
✔ Notifications
✔ Chat
✔ FAQ & Help
✔ Admin Dashboard with charts
✔ Add Event Page

If you want, I can generate thumbnails for all pages.

🎨 UI Theme

Consistent purple neon gradient

Glow effects using box-shadow

Rounded cards and smooth animations

Responsive layouts

⚙️ Future Improvements (Optional Section)

You may add:

JWT authentication integration

Backend deployment

Image uploads for events

Payment gateway integration (Razorpay)

I can write these sections too if you want.

📜 License

This project is for educational and personal use.
Add MIT or Apache license if you want.

👨‍💻 Author

Your Name
GitHub: jhasu_622
Email: jhasujamisetty@gmail.com

from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import include, path

from finance.views import index

urlpatterns = [
    path("admin/", admin.site.urls),
    path("login/", auth_views.LoginView.as_view(), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("api/", include("finance.urls")),
    path("", index, name="index"),
]

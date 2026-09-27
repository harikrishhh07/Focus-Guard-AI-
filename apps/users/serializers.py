from rest_framework import serializers
from django.contrib.auth.models import User
from .models import UserProfile, Goal


from rest_framework_simplejwt.serializers import TokenObtainPairSerializer


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Allows users to sign in with either their username OR their email address."""
    def validate(self, attrs):
        username_or_email = attrs.get(self.username_field)
        if username_or_email and '@' in username_or_email:
            user = User.objects.filter(email__iexact=username_or_email).first()
            if user:
                attrs[self.username_field] = user.username
        return super().validate(attrs)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name']


class UserProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    first_name = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=False, allow_blank=True)
    username = serializers.CharField(source='user.username', read_only=True)
    email = serializers.EmailField(source='user.email', read_only=True)
    display_name = serializers.SerializerMethodField()

    class Meta:
        model = UserProfile
        fields = [
            'id', 'user', 'username', 'email', 'display_name',
            'first_name', 'last_name',
            'occupation', 'daily_focus_goal_hours',
            'work_start_time', 'work_end_time', 'timezone',
            'focus_preferences', 'created_at', 'updated_at'
        ]

    def get_display_name(self, obj):
        full = (obj.user.get_full_name() or '').strip()
        return full or obj.user.username

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['first_name'] = instance.user.first_name or ''
        data['last_name'] = instance.user.last_name or ''
        return data

    def update(self, instance, validated_data):
        first_name = validated_data.pop('first_name', None)
        last_name = validated_data.pop('last_name', None)
        user = instance.user
        if first_name is not None:
            user.first_name = first_name.strip()
        if last_name is not None:
            user.last_name = last_name.strip()
        if first_name is not None or last_name is not None:
            user.save(update_fields=['first_name', 'last_name'])
        return super().update(instance, validated_data)


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'first_name', 'last_name']

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data.get('email', ''),
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', '')
        )
        UserProfile.objects.create(user=user)
        return user


class GoalSerializer(serializers.ModelSerializer):
    class Meta:
        model = Goal
        fields = [
            'id', 'title', 'description', 'target_focus_hours',
            'current_focus_hours', 'target_date', 'status',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

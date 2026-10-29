extends Node2D

@export var enemy_scene: PackedScene
@export var spawn_interval: float = 1.5

@onready var player = $Player

func _ready() -> void:
	var spawn_timer = Timer.new()
	spawn_timer.wait_time = spawn_interval
	spawn_timer.autostart = true
	spawn_timer.timeout.connect(_on_spawn_timer_timeout)
	add_child(spawn_timer)

func _on_spawn_timer_timeout() -> void:
	if not enemy_scene or not player:
		return
		
	var random_angle = randf() * TAU
	var spawn_offset = Vector2.RIGHT.rotated(random_angle) * 500.0
	var enemy = enemy_scene.instantiate()
	enemy.global_position = player.global_position + spawn_offset
	add_child(enemy)

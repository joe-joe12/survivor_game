extends CharacterBody2D

@export var speed: float = 60.0
@export var hp: int = 2
@export var exp_reward: int = 2

var player: Node2D = null

func _ready() -> void:
	add_to_group("enemies")
	player = get_tree().get_first_node_in_group("player")

func _physics_process(_delta: float) -> void:
	if player:
		var dir = (player.global_position - global_position).normalized()
		velocity = dir * speed
		move_and_slide()

func take_damage(amount: int) -> void:
	hp -= amount
	if hp <= 0:
		die()

func die() -> void:
	if player and player.has_method("add_experience"):
		player.add_experience(exp_reward)
	queue_free()

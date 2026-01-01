#!/bin/bash


# TODO: THIS NEEDS TO BE SMARTER
# PROBABLY CAN JUST BAKE IN SOME TEST TRIGGER TYPES AND ACCEPT THE TRIGGER + SUBSCRIPTIONID FROM CLI

echo "Enter subscription id:"

read subscriptionId

CMD="twitch-cli event trigger channel.subscribe -t 118373299 -f 118373299 --transport websocket -u $subscriptionId $@"

echo $CMD

twitch-cli event trigger channel.subscribe -t 118373299 -f 118373299 --transport websocket -u $subscriptionId $@
